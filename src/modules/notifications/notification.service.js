import prisma from '../../config/db.js';
import { AppError, getPagination, buildPaginationMeta } from '../../utils/helpers.js';

const getNotifications = async (userId, { page, limit, isRead }) => {
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const where = {
    userId,
    ...(isRead !== undefined && { isRead: isRead === 'true' }),
  };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return {
    notifications,
    pagination: buildPaginationMeta(total, pageNum, limitNum),
    unreadCount
  };
};

const markAsRead = async (id, userId) => {
  const notification = await prisma.notification.findFirst({ where: { id, userId } });
  if (!notification) throw new AppError('Notification not found', 404);
  return prisma.notification.update({ where: { id }, data: { isRead: true } });
};

const markAllAsRead = async (userId) => {
  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true }
  });
  return true;
};

const createNotification = async ({ userId, type, title, message, metadata }) => {
  return prisma.notification.create({
    data: { userId, type, title, message, metadata }
  });
};

const deleteNotification = async (id, userId) => {
  const notification = await prisma.notification.findFirst({ where: { id, userId } });
  if (!notification) throw new AppError('Notification not found', 404);
  await prisma.notification.delete({ where: { id } });
  return true;
};

export {
  getNotifications,
  markAsRead,
  markAllAsRead,
  createNotification,
  deleteNotification
};