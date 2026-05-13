import chatService from './chat.service.js';
import {
  createConversationSchema,
  sendMessageSchema,
  getMessagesSchema,
} from './chat.validation.js';

class ChatController {

  // GET /chats/conversations
  async getConversations(req, res) {
    try {
      const conversations = await chatService.getUserConversations(req.user.id);
      res.json({ success: true, data: conversations });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // POST /chats/conversations
  async createOrGetConversation(req, res) {
    try {
      const parsed = createConversationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, errors: parsed.error.errors });
      }

      const { participantId, type, ...rest } = parsed.data;

      let conversation;
      if (type === 'DIRECT') {
        conversation = await chatService.getOrCreateDirectConversation(req.user.id, participantId);
      } else {
        conversation = await chatService.createContextConversation(req.user.id, { participantId, type, ...rest });
      }

      res.json({ success: true, data: conversation });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // GET /chats/conversations/:id
  async getConversation(req, res) {
    try {
      const conversation = await chatService.getConversationById(req.params.id, req.user.id);
      res.json({ success: true, data: conversation });
    } catch (err) {
      res.status(404).json({ success: false, message: err.message });
    }
  }

  // GET /chats/conversations/:id/messages
  async getMessages(req, res) {
    try {
      const parsed = getMessagesSchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, errors: parsed.error.errors });
      }

      const messages = await chatService.getMessages(
        req.params.id,
        req.user.id,
        parsed.data
      );
      res.json({ success: true, data: messages });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // POST /chats/conversations/:id/messages
  async sendMessage(req, res) {
    try {
      const parsed = sendMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, errors: parsed.error.errors });
      }

      const message = await chatService.sendMessage(
        req.params.id,
        req.user.id,
        parsed.data
      );

      // Emit via socket
      const io = req.app.get('io');
      if (io) {
        io.to(`conversation:${req.params.id}`).emit('new_message', {
          conversationId: req.params.id,
          message,
        });
      }

      res.status(201).json({ success: true, data: message });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // PUT /chats/conversations/:id/read
  async markAsRead(req, res) {
    try {
      const result = await chatService.markMessagesAsRead(req.params.id, req.user.id);

      // Emit read receipt via socket
      const io = req.app.get('io');
      if (io) {
        io.to(`conversation:${req.params.id}`).emit('messages_read', {
          conversationId: req.params.id,
          userId: req.user.id,
          messageIds: result.messageIds,
        });
      }

      res.json({ success: true, data: result });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // GET /chats/users/search?q=
  async searchUsers(req, res) {
    try {
      const { q } = req.query;
      if (!q || q.trim().length < 1) {
        return res.json({ success: true, data: [] });
      }
      const users = await chatService.searchUsers(q.trim(), req.user.id);
      res.json({ success: true, data: users });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // GET /chats/unread-count
  async getUnreadCount(req, res) {
    try {
      const count = await chatService.getTotalUnreadCount(req.user.id);
      res.json({ success: true, data: { count } });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // GET /chats/booking/:bookingId
  async getBookingConversation(req, res) {
    try {
      const conversation = await chatService.getConversationByBooking(
        req.params.bookingId,
        req.user.id
      );
      res.json({ success: true, data: conversation });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  // GET /chats/lead/:leadId
  async getLeadConversation(req, res) {
    try {
      const conversation = await chatService.getConversationByLead(
        req.params.leadId,
        req.user.id
      );
      res.json({ success: true, data: conversation });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}

export default new ChatController();