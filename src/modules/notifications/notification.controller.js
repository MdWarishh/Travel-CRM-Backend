import * as notificationService from './notification.service.js';
import { ApiResponse } from '../../utils/helpers.js';

const getNotifications = async (req, res) => {
  const result = await notificationService.getNotifications(req.user.id, req.query);
  return res.status(200).json({
    success: true,
    data: result.notifications,
    pagination: result.pagination,
    unreadCount: result.unreadCount
  });
};

const markAsRead = async (req, res) => {
  const notification = await notificationService.markAsRead(req.params.id, req.user.id);
  return ApiResponse.success(res, notification);
};

const markAllAsRead = async (req, res) => {
  await notificationService.markAllAsRead(req.user.id);
  return ApiResponse.success(res, null, 'All notifications marked as read');
};

const deleteNotification = async (req, res) => {
  await notificationService.deleteNotification(req.params.id, req.user.id);
  return ApiResponse.success(res, null, 'Notification deleted');
};

export {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification
};