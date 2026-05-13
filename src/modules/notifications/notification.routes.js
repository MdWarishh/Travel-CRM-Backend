import { Router } from 'express';
import * as c from './notification.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/', c.getNotifications);
router.patch('/mark-all-read', c.markAllAsRead);
router.patch('/:id/read', c.markAsRead);
router.delete('/:id', c.deleteNotification);

export default router;