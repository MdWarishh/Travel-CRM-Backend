import prisma from '../../config/db.js';
import { AppError, getPagination, buildPaginationMeta } from '../../utils/helpers.js';

// ─────────────────────────────────────────────
// PRISMA INCLUDES
// ─────────────────────────────────────────────

const customerListInclude = {
  assignedTo: { select: { id: true, name: true, email: true } },
  _count: { select: { bookings: true, payments: true } },
};

const customerDetailInclude = {
  assignedTo: { select: { id: true, name: true, email: true } },
  bookings: {
    orderBy: { createdAt: 'desc' },
    include: {
      payments: true,
      hotelBookings: true,
      flightBookings: true,
    },
  },
  itineraries: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      destination: true,
      startDate: true,
      endDate: true,
      status: true,
      totalPrice: true,
      createdAt: true,
    },
  },
  payments: {
    orderBy: { createdAt: 'desc' },
  },
  followUps: {
    where: { status: 'PENDING' },
    orderBy: { dueAt: 'asc' },
    take: 5,
  },
  documents: true,
  customerNotes: {
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true } },
    },
  },
  _count: {
    select: {
      bookings: true,
      payments: true,
      itineraries: true,
      customerNotes: true,
    },
  },
};

// ─────────────────────────────────────────────
// HELPER: compute customer stats
// ─────────────────────────────────────────────

const computeCustomerStats = (customer) => {
  const totalSpend = customer.payments?.reduce((sum, p) => sum + (p.paidAmount || 0), 0) ?? 0;

  const completedBookings = customer.bookings?.filter(
    (b) => b.tripStatus === 'COMPLETED'
  ) ?? [];

  const upcomingBookings = customer.bookings?.filter(
    (b) => b.tripStatus === 'UPCOMING'
  ) ?? [];

  const lastTrip = completedBookings.sort(
    (a, b) => new Date(b.travelEnd ?? 0) - new Date(a.travelEnd ?? 0)
  )[0];

  const tags = [];
  if (customer.bookings?.length >= 2) tags.push('Repeat');
  if (totalSpend > 100000) tags.push('VIP');
  if (customer.bookings?.length === 0) tags.push('New');

  return {
    totalSpend,
    totalTrips: customer._count?.bookings ?? 0,
    upcomingTrips: upcomingBookings.length,
    lastTripDate: lastTrip?.travelEnd ?? null,
    tags: [...new Set([...(customer.tags ?? []), ...tags])],
  };
};

// ─────────────────────────────────────────────
// GET ALL CUSTOMERS
// ─────────────────────────────────────────────

const getAllCustomers = async (
  { page, limit, search, assignedToId, filter, sort },
  requestingUser
) => {
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  // --- base where ---
  const where = {
    ...(requestingUser.role === 'AGENT' && { assignedToId: requestingUser.id }),
    ...(assignedToId && requestingUser.role !== 'AGENT' && { assignedToId }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  // --- filter presets ---
  if (filter === 'repeat') {
    where.bookings = { some: {} };
  }
  if (filter === 'recent') {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    where.createdAt = { gte: thirtyDaysAgo };
  }
  if (filter === 'vip') {
    where.tags = { has: 'VIP' };
  }

  // --- sort presets ---
  const orderBy = (() => {
    switch (sort) {
      case 'oldest':
        return { createdAt: 'asc' };
      case 'name_asc':
        return { name: 'asc' };
      case 'name_desc':
        return { name: 'desc' };
      default:
        return { createdAt: 'desc' };
    }
  })();

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: {
        ...customerListInclude,
        bookings: { select: { tripStatus: true, travelEnd: true } },
        payments: { select: { paidAmount: true } },
      },
      skip,
      take,
      orderBy,
    }),
    prisma.customer.count({ where }),
  ]);

  // Attach computed stats to each customer
  const enriched = customers.map((c) => ({
    ...c,
    ...computeCustomerStats(c),
  }));

  return { customers: enriched, pagination: buildPaginationMeta(total, pageNum, limitNum) };
};

// ─────────────────────────────────────────────
// GET CUSTOMER BY ID
// ─────────────────────────────────────────────

const getCustomerById = async (id, requestingUser) => {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: customerDetailInclude,
  });

  if (!customer) throw new AppError('Customer not found', 404);

  if (requestingUser.role === 'AGENT' && customer.assignedToId !== requestingUser.id) {
    throw new AppError('Access denied', 403);
  }

  return {
    ...customer,
    ...computeCustomerStats(customer),
  };
};

// ─────────────────────────────────────────────
// CREATE CUSTOMER
// ─────────────────────────────────────────────

const createCustomer = async (data, requestingUser) => {
  if (requestingUser.role === 'AGENT') data.assignedToId = requestingUser.id;

  // Duplicate check by phone or email
  const existing = await prisma.customer.findFirst({
    where: {
      OR: [
        { phone: data.phone },
        ...(data.email ? [{ email: data.email }] : []),
      ],
    },
  });

  if (existing) {
    throw new AppError(
      `Customer already exists with this ${existing.phone === data.phone ? 'phone' : 'email'}`,
      409
    );
  }

  const { createdFromLeadId, tags, ...rest } = data;

  const customer = await prisma.customer.create({
    data: {
      ...rest,
      tags: tags ?? [],
    },
    include: customerDetailInclude,
  });

  // Activity log
  await logActivity(customer.id, 'CUSTOMER_CREATED', 'Customer profile created', null, requestingUser.id);

  return { ...customer, ...computeCustomerStats(customer) };
};

// ─────────────────────────────────────────────
// CREATE CUSTOMER FROM LEAD (called when Lead marked as Won)
// ─────────────────────────────────────────────

const createCustomerFromLead = async (leadId, requestingUser) => {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new AppError('Lead not found', 404);

  // Check if already converted
  if (lead.convertedCustomerId) {
    return prisma.customer.findUnique({
      where: { id: lead.convertedCustomerId },
      include: customerDetailInclude,
    });
  }

  // Duplicate check
  const existing = await prisma.customer.findFirst({
    where: {
      OR: [
        { phone: lead.phone },
        ...(lead.email ? [{ email: lead.email }] : []),
      ],
    },
  });

  if (existing) {
    // Link lead to existing customer instead of creating new
    await prisma.lead.update({
      where: { id: leadId },
      data: { convertedCustomerId: existing.id },
    });
    return { ...existing, ...computeCustomerStats(existing), alreadyExisted: true };
  }

  // Create new customer
  const customer = await prisma.customer.create({
    data: {
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      assignedToId: lead.assignedToId ?? requestingUser.id,
      tags: [],
      notes: lead.notes,
    },
    include: customerDetailInclude,
  });

  // Link lead → customer
  await prisma.lead.update({
    where: { id: leadId },
    data: { convertedCustomerId: customer.id },
  });

  await logActivity(
    customer.id,
    'CUSTOMER_CREATED',
    `Customer created from Lead: ${lead.name}`,
    { leadId },
    requestingUser.id
  );

  return { ...customer, ...computeCustomerStats(customer) };
};

// ─────────────────────────────────────────────
// UPDATE CUSTOMER
// ─────────────────────────────────────────────

const updateCustomer = async (id, data, requestingUser) => {
  await getCustomerById(id, requestingUser); // auth check

  const { createdFromLeadId, ...rest } = data;

  const customer = await prisma.customer.update({
    where: { id },
    data: rest,
    include: customerDetailInclude,
  });

  await logActivity(id, 'CUSTOMER_UPDATED', 'Customer profile updated', null, requestingUser.id);

  return { ...customer, ...computeCustomerStats(customer) };
};

// ─────────────────────────────────────────────
// DELETE CUSTOMER
// ─────────────────────────────────────────────

const deleteCustomer = async (id) => {
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) throw new AppError('Customer not found', 404);
  await prisma.customer.delete({ where: { id } });
  return true;
};

// ─────────────────────────────────────────────
// SEND WHATSAPP
// ─────────────────────────────────────────────

const sendWhatsApp = async (data, requestingUser) => {
  const { customerId, message, templateId, attachmentUrl, phone } = data;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new AppError('Customer not found', 404);

  const targetPhone = phone || customer.phone;
  if (!targetPhone) throw new AppError('Customer has no phone number', 400);

  // Build WhatsApp URL (web.whatsapp.com link — works in browser)
  const encodedMessage = encodeURIComponent(message);
  const cleanPhone = targetPhone.replace(/[^0-9]/g, '');
  const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;

  // Save communication record
  const communication = await prisma.customerCommunication.create({
    data: {
      customerId,
      channel: 'WHATSAPP',
      status: 'SENT',
      message,
      attachmentUrl: attachmentUrl ?? null,
      templateId: templateId ?? null,
      sentById: requestingUser.id,
    },
  });

  // Activity log
  await logActivity(
    customerId,
    'WHATSAPP_SENT',
    `WhatsApp sent to ${targetPhone}`,
    { communicationId: communication.id, templateId },
    requestingUser.id
  );

  return { communication, whatsappUrl, phone: targetPhone };
};

// ─────────────────────────────────────────────
// SEND EMAIL
// ─────────────────────────────────────────────

const sendEmail = async (data, requestingUser) => {
  const { customerId, subject, message, attachmentUrl, attachmentName, email } = data;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new AppError('Customer not found', 404);

  const targetEmail = email || customer.email;
  if (!targetEmail) throw new AppError('Customer has no email address', 400);

  // NOTE: Integrate with your email provider here (Nodemailer, Resend, SendGrid, etc.)
  // This stores the record and returns the data for the caller to send.
  // Example with Resend/Nodemailer — plug in your provider:
  //
  // await emailProvider.send({
  //   to: targetEmail,
  //   subject,
  //   html: message,
  //   attachments: attachmentUrl ? [{ url: attachmentUrl, filename: attachmentName }] : [],
  // });

  const communication = await prisma.customerCommunication.create({
    data: {
      customerId,
      channel: 'EMAIL',
      status: 'SENT',
      subject,
      message,
      attachmentUrl: attachmentUrl ?? null,
      sentById: requestingUser.id,
    },
  });

  await logActivity(
    customerId,
    'EMAIL_SENT',
    `Email sent to ${targetEmail}: "${subject}"`,
    { communicationId: communication.id, subject },
    requestingUser.id
  );

  return { communication, email: targetEmail };
};

// ─────────────────────────────────────────────
// GET COMMUNICATIONS (WhatsApp + Email history)
// ─────────────────────────────────────────────

const getCustomerCommunications = async (customerId, requestingUser) => {
  await getCustomerById(customerId, requestingUser);

  return prisma.customerCommunication.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    include: {
      sentBy: { select: { id: true, name: true } },
      template: { select: { id: true, name: true } },
    },
  });
};

// ─────────────────────────────────────────────
// NOTES
// ─────────────────────────────────────────────

const addNote = async (customerId, data, requestingUser) => {
  await getCustomerById(customerId, requestingUser);

  const note = await prisma.customerNote.create({
    data: {
      customerId,
      content: data.content,
      type: data.type ?? 'GENERAL',
      createdById: requestingUser.id,
    },
    include: {
      createdBy: { select: { id: true, name: true } },
    },
  });

  await logActivity(customerId, 'NOTE_ADDED', 'Note added', { noteId: note.id }, requestingUser.id);
  return note;
};

const updateNote = async (customerId, noteId, data, requestingUser) => {
  await getCustomerById(customerId, requestingUser);

  const note = await prisma.customerNote.findFirst({ where: { id: noteId, customerId } });
  if (!note) throw new AppError('Note not found', 404);

  const updated = await prisma.customerNote.update({
    where: { id: noteId },
    data,
    include: { createdBy: { select: { id: true, name: true } } },
  });

  await logActivity(customerId, 'NOTE_UPDATED', 'Note updated', { noteId }, requestingUser.id);
  return updated;
};

const deleteNote = async (customerId, noteId, requestingUser) => {
  await getCustomerById(customerId, requestingUser);
  const note = await prisma.customerNote.findFirst({ where: { id: noteId, customerId } });
  if (!note) throw new AppError('Note not found', 404);
  await prisma.customerNote.delete({ where: { id: noteId } });
  return true;
};

const getCustomerNotes = async (customerId, requestingUser) => {
  await getCustomerById(customerId, requestingUser);
  return prisma.customerNote.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { id: true, name: true } } },
  });
};

// ─────────────────────────────────────────────
// ACTIVITY LOG
// ─────────────────────────────────────────────

const logActivity = async (customerId, type, title, metadata, performedById) => {
  return prisma.customerActivityLog.create({
    data: {
      customerId,
      type,
      title,
      metadata: metadata ?? undefined,
      performedById: performedById ?? undefined,
    },
  });
};

const getActivityLog = async (customerId, requestingUser) => {
  await getCustomerById(customerId, requestingUser);

  return prisma.customerActivityLog.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    include: {
      performedBy: { select: { id: true, name: true } },
    },
  });
};

// ─────────────────────────────────────────────
// COMMUNICATION TEMPLATES
// ─────────────────────────────────────────────

const getTemplates = async (type) => {
  return prisma.communicationTemplate.findMany({
    where: {
      isActive: true,
      ...(type ? { type } : {}),
    },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
};

const createTemplate = async (data, requestingUser) => {
  return prisma.communicationTemplate.create({
    data: {
      ...data,
      createdById: requestingUser.id,
    },
  });
};

const updateTemplate = async (id, data) => {
  const template = await prisma.communicationTemplate.findUnique({ where: { id } });
  if (!template) throw new AppError('Template not found', 404);
  return prisma.communicationTemplate.update({ where: { id }, data });
};

const deleteTemplate = async (id) => {
  const template = await prisma.communicationTemplate.findUnique({ where: { id } });
  if (!template) throw new AppError('Template not found', 404);
  await prisma.communicationTemplate.delete({ where: { id } });
  return true;
};

// ─────────────────────────────────────────────
// FULL TIMELINE (for detail page tabs)
// ─────────────────────────────────────────────

const getCustomerTimeline = async (id, requestingUser) => {
  await getCustomerById(id, requestingUser);

  const [bookings, payments, followUps, itineraries, activityLogs, communications] =
    await Promise.all([
      prisma.booking.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        include: {
          payments: true,
          hotelBookings: true,
          flightBookings: true,
        },
      }),
      prisma.payment.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.followUp.findMany({
        where: { customerId: id },
        orderBy: { dueAt: 'desc' },
        include: {
          assignedTo: { select: { id: true, name: true } },
        },
      }),
      prisma.itinerary.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customerActivityLog.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          performedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.customerCommunication.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        include: {
          sentBy: { select: { id: true, name: true } },
        },
      }),
    ]);

  // Payment summary
  const totalPaid = payments.reduce((sum, p) => sum + (p.paidAmount ?? 0), 0);
  const totalDue = payments.reduce((sum, p) => sum + (p.dueAmount ?? 0), 0);
  const pendingPayments = payments.filter((p) => p.status !== 'PAID');

  return {
    bookings,
    payments,
    paymentSummary: { totalPaid, totalDue, pendingPayments },
    followUps,
    itineraries,
    activityLogs,
    communications,
  };
};

// ─────────────────────────────────────────────
// SHARE PDF (logs the share action)
// ─────────────────────────────────────────────

const sharePdf = async ({ customerId, documentUrl, channel, entityType }, requestingUser) => {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new AppError('Customer not found', 404);

  await logActivity(
    customerId,
    'PDF_SHARED',
    `PDF shared via ${channel} (${entityType})`,
    { documentUrl, channel, entityType },
    requestingUser.id
  );

  return { success: true };
};

export default {
  getAllCustomers,
  getCustomerById,
  createCustomer,
  createCustomerFromLead,
  updateCustomer,
  deleteCustomer,
  sendWhatsApp,
  sendEmail,
  getCustomerCommunications,
  addNote,
  updateNote,
  deleteNote,
  getCustomerNotes,
  logActivity,
  getActivityLog,
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getCustomerTimeline,
  sharePdf,
};