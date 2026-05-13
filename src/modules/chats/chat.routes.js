import express from 'express';
import chatController from './chat.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = express.Router();

// 🔐 All routes protected
router.use(authenticate);

// =============================
// 📩 Conversations
// =============================
router
  .route('/conversations')
  .get(chatController.getConversations.bind(chatController))
  .post(chatController.createOrGetConversation.bind(chatController));

router
  .route('/conversations/:id')
  .get(chatController.getConversation.bind(chatController));

// =============================
// 💬 Messages
// =============================
router
  .route('/conversations/:id/messages')
  .get(chatController.getMessages.bind(chatController))
  .post(chatController.sendMessage.bind(chatController));

router.put(
  '/conversations/:id/read',
  chatController.markAsRead.bind(chatController)
);

// =============================
// 🔍 Search
// =============================
router.get(
  '/users/search',
  chatController.searchUsers.bind(chatController)
);

// =============================
// 🔔 Unread
// =============================
router.get(
  '/unread-count',
  chatController.getUnreadCount.bind(chatController)
);

// =============================
// 🔗 Context Conversations
// =============================
router.get(
  '/booking/:bookingId',
  chatController.getBookingConversation.bind(chatController)
);

router.get(
  '/lead/:leadId',
  chatController.getLeadConversation.bind(chatController)
);

export default router;