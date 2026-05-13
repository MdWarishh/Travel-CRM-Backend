import prisma from '../../config/db.js';
import { AppError, getPagination, buildPaginationMeta } from '../../utils/helpers.js';
import { emitToUser, emitToRole } from '../../sockets/index.js';
import nodemailer from 'nodemailer';

// ─── Email transporter ────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const taskInclude = {
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
  createdBy:  { select: { id: true, name: true, email: true, role: true } },
};

const computeReminderTime = (dueDateTime, reminderBeforeMinutes) => {
  const due = new Date(dueDateTime);
  return new Date(due.getTime() - reminderBeforeMinutes * 60 * 1000);
};

const formatDueDateTime = (dt) =>
  new Date(dt).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });

// ─── Send email reminder ──────────────────────────────────────────────────────
const sendReminderEmail = async (toEmail, task) => {
  try {
    await transporter.sendMail({
      from: `"Travel CRM" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: toEmail,
      subject: `Reminder: ${task.title}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px">
          <h2 style="margin-top:0;color:#1a56db">⏰ Task Reminder</h2>
          <p>Hi,</p>
          <p>This is a reminder for your ${task.type.toLowerCase().replace('_', '-')}:</p>
          <div style="background:#f9fafb;padding:16px;border-radius:6px;margin:16px 0">
            <strong style="font-size:16px">${task.title}</strong>
            ${task.description ? `<p style="color:#6b7280;margin:8px 0 0">${task.description}</p>` : ''}
          </div>
          <p><strong>Due at:</strong> ${formatDueDateTime(task.dueDateTime)}</p>
          <p style="color:#ef4444;font-weight:600">Please take action.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
          <p style="color:#9ca3af;font-size:12px">Travel CRM — Automated Reminder</p>
        </div>
      `,
    });
  } catch (err) {
    console.error('❌ Email send failed:', err.message);
  }
};

// ─── Create in-app notification ───────────────────────────────────────────────
const createNotification = async (userId, title, message, metadata = null) => {
  const notification = await prisma.notification.create({
    data: {
      userId,
      type: 'SYSTEM',
      title,
      message,
      ...(metadata && { metadata }),
    },
  });
  emitToUser(userId, 'new_notification', { notification });
  return notification;
};

// ═════════════════════════════════════════════════════════════════════════════
// CRUD
// ═════════════════════════════════════════════════════════════════════════════

export const getAllTasks = async (query, requestingUser) => {
  const { page, limit, filter, search, priority, type, assignedToId } = query;
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  let dateFilter = {};
  if (filter === 'today') {
    dateFilter = { dueDateTime: { gte: todayStart, lt: todayEnd } };
  } else if (filter === 'upcoming') {
    dateFilter = { dueDateTime: { gt: now }, status: 'PENDING' };
  } else if (filter === 'overdue') {
    dateFilter = { dueDateTime: { lt: now }, status: 'PENDING' };
  } else if (filter === 'completed') {
    dateFilter = { status: 'COMPLETED' };
  }

  const where = {
    ...dateFilter,
    ...(priority && { priority }),
    ...(type && { type }),
    ...(requestingUser.role === 'AGENT' && { assignedToId: requestingUser.id }),
    ...(assignedToId && requestingUser.role !== 'AGENT' && { assignedToId }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { relatedToId: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: taskInclude,
      skip,
      take,
      orderBy: { dueDateTime: 'asc' },
    }),
    prisma.task.count({ where }),
  ]);

  return { tasks, pagination: buildPaginationMeta(total, pageNum, limitNum) };
};

export const getTaskById = async (id, requestingUser) => {
  const task = await prisma.task.findUnique({ where: { id }, include: taskInclude });
  if (!task) throw new AppError('Task not found', 404);

  if (
    requestingUser.role === 'AGENT' &&
    task.assignedToId !== requestingUser.id &&
    task.createdById !== requestingUser.id
  ) {
    throw new AppError('Access denied', 403);
  }

  return task;
};

export const createTask = async (data, requestingUser) => {
  const reminderTime = computeReminderTime(data.dueDateTime, data.reminderBeforeMinutes);

  const task = await prisma.task.create({
    data: {
      title: data.title,
      ...(data.description && { description: data.description }),
      type: data.type || 'TASK',
      ...(data.relatedToType && { relatedToType: data.relatedToType }),
      ...(data.relatedToId   && { relatedToId:   data.relatedToId   }),
      ...(data.assignedToId  && { assignedToId:  data.assignedToId  }),
      dueDateTime:            new Date(data.dueDateTime),
      reminderBeforeMinutes:  data.reminderBeforeMinutes ?? 30,
      reminderTime,
      reminderSent:           false,
      priority:               data.priority || 'MEDIUM',
      status:                 'PENDING',
      createdById:            requestingUser.id,
    },
    include: taskInclude,
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId:   requestingUser.id,
      action:   'task_created',
      entity:   'Task',
      entityId: task.id,
      metadata: { title: task.title, type: task.type },
    },
  });

  // Notify assignee
  if (task.assignedToId && task.assignedToId !== requestingUser.id) {
    await createNotification(
      task.assignedToId,
      'New Task Assigned',
      `You have a new ${task.type.toLowerCase()} assigned: ${task.title}`,
      { taskId: task.id }
    );
  }

  return task;
};

export const updateTask = async (id, data, requestingUser) => {
  const existing = await getTaskById(id, requestingUser);

  const updateData = { ...data };

  // Recompute reminder time if dueDateTime or reminderBeforeMinutes changed
  if (data.dueDateTime || data.reminderBeforeMinutes !== undefined) {
    const dueDateTime           = data.dueDateTime ? new Date(data.dueDateTime) : existing.dueDateTime;
    const reminderBeforeMinutes = data.reminderBeforeMinutes ?? existing.reminderBeforeMinutes;
    updateData.reminderTime     = computeReminderTime(dueDateTime, reminderBeforeMinutes);
    updateData.reminderSent     = false; // reset so it fires again
    if (data.dueDateTime) updateData.dueDateTime = new Date(data.dueDateTime);
  }

  if (data.status === 'COMPLETED') {
    updateData.completedAt = new Date();
  }

  const updated = await prisma.task.update({
    where: { id },
    data: updateData,
    include: taskInclude,
  });

  await prisma.activityLog.create({
    data: {
      userId:   requestingUser.id,
      action:   data.status === 'COMPLETED' ? 'task_completed' : 'task_updated',
      entity:   'Task',
      entityId: id,
      metadata: { title: updated.title, status: updated.status },
    },
  });

  // Notify new assignee if changed
  if (
    data.assignedToId &&
    data.assignedToId !== existing.assignedToId &&
    data.assignedToId !== requestingUser.id
  ) {
    await createNotification(
      data.assignedToId,
      'Task Assigned',
      `You have been assigned: ${updated.title}`,
      { taskId: id }
    );
  }

  return updated;
};

export const deleteTask = async (id, requestingUser) => {
  await getTaskById(id, requestingUser);
  await prisma.task.delete({ where: { id } });

  await prisma.activityLog.create({
    data: {
      userId:   requestingUser.id,
      action:   'task_deleted',
      entity:   'Task',
      entityId: id,
    },
  });

  return true;
};

// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ═════════════════════════════════════════════════════════════════════════════

export const getTaskStats = async (requestingUser) => {
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const userFilter =
    requestingUser.role === 'AGENT' ? { assignedToId: requestingUser.id } : {};

  const [todayCount, upcomingCount, overdueCount, completedCount, todayTasks, upcomingTasks, overdueTasks] =
    await Promise.all([
      prisma.task.count({ where: { ...userFilter, dueDateTime: { gte: todayStart, lt: todayEnd } } }),
      prisma.task.count({ where: { ...userFilter, dueDateTime: { gt: now },  status: 'PENDING' } }),
      prisma.task.count({ where: { ...userFilter, dueDateTime: { lt: now },  status: 'PENDING' } }),
      prisma.task.count({ where: { ...userFilter, status: 'COMPLETED' } }),
      prisma.task.findMany({
        where: { ...userFilter, dueDateTime: { gte: todayStart, lt: todayEnd } },
        include: taskInclude,
        orderBy: { dueDateTime: 'asc' },
        take: 10,
      }),
      prisma.task.findMany({
        where: { ...userFilter, dueDateTime: { gte: todayEnd }, status: 'PENDING' },
        include: taskInclude,
        orderBy: { dueDateTime: 'asc' },
        take: 5,
      }),
      prisma.task.findMany({
        where: { ...userFilter, dueDateTime: { lt: now }, status: 'PENDING' },
        include: taskInclude,
        orderBy: { dueDateTime: 'asc' },
        take: 5,
      }),
    ]);

  return {
    counts: { today: todayCount, upcoming: upcomingCount, overdue: overdueCount, completed: completedCount },
    todayTasks,
    upcomingTasks,
    overdueTasks,
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// CRON JOB — runs every minute
// ═════════════════════════════════════════════════════════════════════════════

export const runReminderJob = async () => {
  const now    = new Date();
  const from   = new Date(now.getTime() - 60 * 1000); // 1 min window
  const to     = new Date(now.getTime());

  // ── 1. Send reminders for tasks whose reminderTime is NOW ─────────────────
  const dueTasks = await prisma.task.findMany({
    where: {
      reminderSent: false,
      status:       'PENDING',
      reminderTime: { gte: from, lte: to },
    },
    include: {
      ...taskInclude,
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });

  for (const task of dueTasks) {
    const minutesLeft = Math.round((new Date(task.dueDateTime) - now) / 60000);
    const msg =
      task.type === 'MEETING'
        ? `You have a meeting in ${minutesLeft} minute(s): ${task.title}`
        : `Reminder: ${task.title} is due in ${minutesLeft} minute(s)`;

    // In-app notification
    if (task.assignedToId) {
      await createNotification(task.assignedToId, 'Task Reminder', msg, { taskId: task.id });

      // Email
      if (task.assignedTo?.email) {
        await sendReminderEmail(task.assignedTo.email, task);
      }
    } else if (task.createdById) {
      const creator = await prisma.user.findUnique({
        where:  { id: task.createdById },
        select: { id: true, email: true },
      });
      if (creator) {
        await createNotification(creator.id, 'Task Reminder', msg, { taskId: task.id });
        if (creator.email) await sendReminderEmail(creator.email, task);
      }
    }

    // Mark reminder sent + log
    await prisma.task.update({
      where: { id: task.id },
      data:  { reminderSent: true },
    });

    await prisma.activityLog.create({
      data: {
        action:   'reminder_sent',
        entity:   'Task',
        entityId: task.id,
        metadata: { title: task.title, sentAt: now },
      },
    });
  }

  // ── 2. Notify overdue tasks ───────────────────────────────────────────────
  const overdueTasks = await prisma.task.findMany({
    where: {
      status:      'PENDING',
      dueDateTime: { lt: now },
      overdueNotified: false,
    },
    include: taskInclude,
  });

  for (const task of overdueTasks) {
    const msg = `Task overdue: ${task.title}`;
    const targetUserId = task.assignedToId || task.createdById;
    if (targetUserId) {
      await createNotification(targetUserId, 'Task Overdue', msg, { taskId: task.id });
    }
    await prisma.task.update({
      where: { id: task.id },
      data:  { overdueNotified: true },
    });
  }

  console.log(`⏰ Reminder job: ${dueTasks.length} reminders sent, ${overdueTasks.length} overdue notified`);
};

// ═════════════════════════════════════════════════════════════════════════════
// AUTO TASK CREATION (Smart Feature)
// ═════════════════════════════════════════════════════════════════════════════

export const createAutoTasksForBooking = async (bookingId, assignedToId, createdById) => {
  const autoTasks = [
    { title: 'Confirm hotel booking',  description: 'Verify hotel confirmation with vendor',  priority: 'HIGH'   },
    { title: 'Assign driver/transport', description: 'Arrange transport for the booking',     priority: 'MEDIUM' },
    { title: 'Send itinerary to customer', description: 'Share final itinerary PDF',          priority: 'MEDIUM' },
  ];

  const dueDateTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h from now
  const reminderBeforeMinutes = 60;

  const created = [];
  for (const t of autoTasks) {
    const task = await prisma.task.create({
      data: {
        title:                 t.title,
        description:           t.description,
        type:                  'TASK',
        relatedToType:         'BOOKING',
        relatedToId:           bookingId,
        assignedToId:          assignedToId || null,
        dueDateTime,
        reminderBeforeMinutes,
        reminderTime:          computeReminderTime(dueDateTime, reminderBeforeMinutes),
        reminderSent:          false,
        overdueNotified:       false,
        priority:              t.priority,
        status:                'PENDING',
        createdById:           createdById || null,
      },
    });
    created.push(task);
  }

  return created;
};

export const createAutoTaskForPayment = async (bookingId, assignedToId, createdById) => {
  const dueDateTime = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12h
  return prisma.task.create({
    data: {
      title:                 'Collect pending payment',
      description:           'Payment is pending for this booking. Contact customer.',
      type:                  'FOLLOW_UP',
      relatedToType:         'BOOKING',
      relatedToId:           bookingId,
      assignedToId:          assignedToId || null,
      dueDateTime,
      reminderBeforeMinutes: 30,
      reminderTime:          computeReminderTime(dueDateTime, 30),
      reminderSent:          false,
      overdueNotified:       false,
      priority:              'HIGH',
      status:                'PENDING',
      createdById:           createdById || null,
    },
  });
};

export const createAutoFollowUpAfterItinerary = async (customerId, assignedToId, createdById) => {
  const dueDateTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day
  return prisma.task.create({
    data: {
      title:                 'Follow-up after itinerary sent',
      description:           'Check if customer reviewed the itinerary and has feedback.',
      type:                  'FOLLOW_UP',
      relatedToType:         'CUSTOMER',
      relatedToId:           customerId,
      assignedToId:          assignedToId || null,
      dueDateTime,
      reminderBeforeMinutes: 30,
      reminderTime:          computeReminderTime(dueDateTime, 30),
      reminderSent:          false,
      overdueNotified:       false,
      priority:              'MEDIUM',
      status:                'PENDING',
      createdById:           createdById || null,
    },
  });
};