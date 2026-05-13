import prisma from '../../config/db.js';
import { AppError, getPagination, buildPaginationMeta } from '../../utils/helpers.js';
import { emitToUser } from '../../sockets/index.js';

const followupInclude = {
  lead: { select: { id: true, name: true, phone: true } },
  customer: { select: { id: true, name: true, phone: true } },
  assignedTo: { select: { id: true, name: true } },
};

const getAllFollowUps = async ({ page, limit, status, type, assignedToId, dueDate }, requestingUser) => {
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const where = {
    ...(requestingUser.role === 'AGENT' && { assignedToId: requestingUser.id }),
    ...(status && { status }),
    ...(type && { type }),
    ...(assignedToId && requestingUser.role !== 'AGENT' && { assignedToId }),
    ...(dueDate && {
      dueAt: {
        gte: new Date(dueDate),
        lt: new Date(new Date(dueDate).setDate(new Date(dueDate).getDate() + 1)),
      },
    }),
  };

  const [followUps, total] = await Promise.all([
    prisma.followUp.findMany({
      where,
      include: followupInclude,
      skip,
      take,
      orderBy: { dueAt: 'asc' },
    }),
    prisma.followUp.count({ where }),
  ]);

  return { followUps, pagination: buildPaginationMeta(total, pageNum, limitNum) };
};

const getTodayFollowUps = async (requestingUser) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const where = {
    status: 'PENDING',
    dueAt: { gte: today, lt: tomorrow },
    ...(requestingUser.role === 'AGENT' && { assignedToId: requestingUser.id }),
  };

  return prisma.followUp.findMany({
    where,
    include: followupInclude,
    orderBy: { dueAt: 'asc' },
  });
};

const createFollowUp = async (data, requestingUser) => {
  if (requestingUser.role === 'AGENT') data.assignedToId = requestingUser.id;

  const followUp = await prisma.followUp.create({
    data,
    include: followupInclude,
  });

  // Notify assigned agent
  if (followUp.assignedToId) {
    emitToUser(followUp.assignedToId, 'followup_created', { followUp });
  }

  return followUp;
};

const updateFollowUp = async (id, data, requestingUser) => {
  const existing = await prisma.followUp.findUnique({ where: { id } });
  if (!existing) throw new AppError('Follow-up not found', 404);

  if (requestingUser.role === 'AGENT' && existing.assignedToId !== requestingUser.id) {
    throw new AppError('Access denied', 403);
  }

  // If marking complete
  if (data.status === 'COMPLETED' && !existing.completedAt) {
    data.completedAt = new Date();
  }

  return prisma.followUp.update({
    where: { id },
    data,
    include: followupInclude,
  });
};

const deleteFollowUp = async (id) => {
  const existing = await prisma.followUp.findUnique({ where: { id } });
  if (!existing) throw new AppError('Follow-up not found', 404);

  await prisma.followUp.delete({ where: { id } });
  return true;
};

export default {
  getAllFollowUps,
  getTodayFollowUps,
  createFollowUp,
  updateFollowUp,
  deleteFollowUp,
};