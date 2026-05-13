import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import chatService from '../modules/chats/chat.service.js';

const prisma = new PrismaClient();

export const initializeSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // 🔐 Auth Middleware
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(' ')[1];

      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await prisma.user.findUnique({
        where: { id: decoded.id || decoded.userId },
        select: {
          id: true,
          name: true,
          role: true,
          profileImage: true,
        },
      });

      if (!user) return next(new Error('User not found'));

      socket.userId = user.id;
      socket.user = user;

      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // 🔌 Connection
  io.on('connection', async (socket) => {
    console.log(`🔌 User connected: ${socket.user.name} [${socket.userId}]`);

    await chatService.updateUserOnlineStatus(socket.userId, true, socket.id);

    socket.join(`user:${socket.userId}`);

    socket.broadcast.emit('user_online', {
      userId: socket.userId,
      isOnline: true,
    });

    // 👉 Join Conversation
    socket.on('join_conversation', async ({ conversationId }) => {
      try {
        const conv = await prisma.conversation.findFirst({
          where: {
            id: conversationId,
            participants: { some: { userId: socket.userId } },
          },
        });

        if (!conv) return;

        socket.join(`conversation:${conversationId}`);
        socket.emit('joined_conversation', { conversationId });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // 👉 Leave Conversation
    socket.on('leave_conversation', ({ conversationId }) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // 👉 Send Message
    socket.on('send_message', async (data) => {
      try {
        const {
          conversationId,
          messageText,
          messageType = 'TEXT',
          attachmentUrl,
          metadata,
        } = data;

        const message = await chatService.sendMessage(
          conversationId,
          socket.userId,
          {
            messageText,
            messageType,
            attachmentUrl,
            metadata,
          }
        );

        io.to(`conversation:${conversationId}`).emit('new_message', {
          conversationId,
          message,
        });

        const conv = await prisma.conversation.findUnique({
          where: { id: conversationId },
          include: { participants: true },
        });

        for (const p of conv.participants) {
          if (p.userId !== socket.userId) {
            io.to(`user:${p.userId}`).emit('notification_new_message', {
              conversationId,
              message,
              sender: socket.user,
            });
          }
        }
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // 👉 Typing
    socket.on('typing_start', ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit('user_typing', {
        conversationId,
        userId: socket.userId,
        userName: socket.user.name,
      });
    });

    socket.on('typing_stop', ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit('user_stopped_typing', {
        conversationId,
        userId: socket.userId,
      });
    });

    // 👉 Mark Read
    socket.on('mark_read', async ({ conversationId }) => {
      try {
        const result = await chatService.markMessagesAsRead(
          conversationId,
          socket.userId
        );

        io.to(`conversation:${conversationId}`).emit('messages_read', {
          conversationId,
          userId: socket.userId,
          messageIds: result.messageIds,
        });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // ❌ Disconnect
    socket.on('disconnect', async () => {
      console.log(`❌ User disconnected: ${socket.user.name}`);

      await chatService.updateUserOnlineStatus(socket.userId, false, null);

      socket.broadcast.emit('user_offline', {
        userId: socket.userId,
        lastSeen: new Date(),
      });
    });
  });

  return io;
};