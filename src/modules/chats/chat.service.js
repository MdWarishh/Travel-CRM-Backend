import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class ChatService {

  // ─── Conversations ───────────────────────────────────────

  async getOrCreateDirectConversation(userId, participantId) {
    const existing = await prisma.conversation.findFirst({
      where: {
        type: 'DIRECT',
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: participantId } } },
        ],
      },
      include: this._conversationInclude(),
    });

    if (existing) return existing;

    return prisma.conversation.create({
      data: {
        type: 'DIRECT',
        participants: {
          create: [
            { userId },
            { userId: participantId },
          ],
        },
      },
      include: this._conversationInclude(),
    });
  }

  async createContextConversation(userId, data) {
    const { participantId, type, title, bookingId, leadId, customerId } = data;

    return prisma.conversation.create({
      data: {
        type,
        title,
        bookingId,
        leadId,
        customerId,
        participants: {
          create: [
            { userId },
            { userId: participantId },
          ],
        },
      },
      include: this._conversationInclude(),
    });
  }

  async getUserConversations(userId) {
    const conversations = await prisma.conversation.findMany({
      where: {
        participants: { some: { userId } },
      },
      include: {
        ...this._conversationInclude(),
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, name: true, profileImage: true } },
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conv) => {
        const participant = conv.participants.find(p => p.userId === userId);
        const unreadCount = await prisma.message.count({
          where: {
            conversationId: conv.id,
            senderId: { not: userId },
            createdAt: participant?.lastReadAt
              ? { gt: participant.lastReadAt }
              : undefined,
            readReceipts: { none: { userId } },
          },
        });

        return { ...conv, unreadCount };
      })
    );

    return conversationsWithUnread;
  }

  async getConversationById(conversationId, userId) {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: { some: { userId } },
      },
      include: this._conversationInclude(),
    });

    if (!conversation) throw new Error('Conversation not found or access denied');
    return conversation;
  }

  // ─── Messages ────────────────────────────────────────────

  async getMessages(conversationId, userId, { page = 1, limit = 50, cursor } = {}) {
    await this.getConversationById(conversationId, userId);

    const where = { conversationId };
    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }

    const messages = await prisma.message.findMany({
      where,
      include: {
        sender: { select: { id: true, name: true, profileImage: true, role: true } },
        readReceipts: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: cursor ? 0 : (page - 1) * limit,
    });

    return messages.reverse();
  }

  async sendMessage(conversationId, senderId, data) {
    await this.getConversationById(conversationId, senderId);

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId,
        messageText: data.messageText,
        messageType: data.messageType || 'TEXT',
        attachmentUrl: data.attachmentUrl,
        metadata: data.metadata,
        status: 'SENT',
      },
      include: {
        sender: { select: { id: true, name: true, profileImage: true, role: true } },
        readReceipts: true,
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    return message;
  }

  async markMessagesAsRead(conversationId, userId) {
    await this.getConversationById(conversationId, userId);

    const unreadMessages = await prisma.message.findMany({
      where: {
        conversationId,
        senderId: { not: userId },
        readReceipts: { none: { userId } },
      },
      select: { id: true },
    });

    if (unreadMessages.length === 0) return { count: 0 };

    await prisma.messageReadReceipt.createMany({
      data: unreadMessages.map(msg => ({
        messageId: msg.id,
        userId,
      })),
      skipDuplicates: true,
    });

    await prisma.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: new Date() },
    });

    return {
      count: unreadMessages.length,
      messageIds: unreadMessages.map(m => m.id),
    };
  }

  // ─── System / Task Messages ───────────────────────────────

  async sendSystemMessage(conversationId, text, metadata = {}) {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: { take: 1 } },
    });

    if (!conv || !conv.participants[0]) return null;

    return prisma.message.create({
      data: {
        conversationId,
        senderId: conv.participants[0].userId,
        messageText: text,
        messageType: 'SYSTEM',
        metadata,
        status: 'DELIVERED',
      },
      include: {
        sender: { select: { id: true, name: true } },
      },
    });
  }

  async sendTaskMessage(conversationId, senderId, task) {
    return prisma.message.create({
      data: {
        conversationId,
        senderId,
        messageText: `📋 Task Assigned: ${task.title}`,
        messageType: 'TASK',
        metadata: {
          taskId: task.id,
          taskTitle: task.title,
          taskPriority: task.priority,
          taskDueAt: task.dueAt,
          leadId: task.leadId,
        },
        status: 'SENT',
      },
      include: {
        sender: { select: { id: true, name: true, profileImage: true } },
      },
    });
  }

  // ─── User Status ──────────────────────────────────────────

  async updateUserOnlineStatus(userId, isOnline, socketId = null) {
    return prisma.userOnlineStatus.upsert({
      where: { userId },
      create: { userId, isOnline, socketId, lastSeen: new Date() },
      update: { isOnline, socketId, lastSeen: new Date() },
    });
  }

  async getUsersOnlineStatus(userIds) {
    return prisma.userOnlineStatus.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, isOnline: true, lastSeen: true },
    });
  }

  // ─── Search ───────────────────────────────────────────────

  async searchUsers(query, currentUserId) {
    return prisma.user.findMany({
      where: {
        id: { not: currentUserId },
        status: 'ACTIVE',
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        profileImage: true,
        role: true,
        department: true,
        onlineStatus: {
          select: { isOnline: true, lastSeen: true },
        },
      },
      take: 20,
    });
  }

  async getConversationByBooking(bookingId, userId) {
    return prisma.conversation.findFirst({
      where: {
        bookingId,
        participants: { some: { userId } },
      },
      include: this._conversationInclude(),
    });
  }

  async getConversationByLead(leadId, userId) {
    return prisma.conversation.findFirst({
      where: {
        leadId,
        participants: { some: { userId } },
      },
      include: this._conversationInclude(),
    });
  }

  async getTotalUnreadCount(userId) {
    const participant = await prisma.conversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true, lastReadAt: true },
    });

    let total = 0;
    for (const p of participant) {
      const count = await prisma.message.count({
        where: {
          conversationId: p.conversationId,
          senderId: { not: userId },
          readReceipts: { none: { userId } },
          ...(p.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {}),
        },
      });
      total += count;
    }

    return total;
  }

  // ─── Private Helpers ──────────────────────────────────────

  _conversationInclude() {
    return {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              profileImage: true,
              role: true,
              department: true,
              onlineStatus: { select: { isOnline: true, lastSeen: true } },
            },
          },
        },
      },
      booking: { select: { id: true, status: true, customer: { select: { name: true } } } },
      lead: { select: { id: true, name: true, phone: true } },
      customer: { select: { id: true, name: true, phone: true } },
    };
  }
}

export default new ChatService();