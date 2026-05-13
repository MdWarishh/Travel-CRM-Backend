import chatService from './chat.service.js';

/**
 * Task assign hone par automatically chat message bhejo
 * Call this from your task service when a task is assigned
 */
export const notifyTaskAssigned = async ({
  assignedToId,
  assignedById,
  task,
  io,
}) => {
  try {
    // Get or create direct conversation between assigner and assignee
    const conversation = await chatService.getOrCreateDirectConversation(
      assignedById,
      assignedToId
    );

    // Send task message
    const message = await chatService.sendTaskMessage(
      conversation.id,
      assignedById,
      task
    );

    // Emit via socket
    if (io) {
      io.to(`conversation:${conversation.id}`).emit('new_message', {
        conversationId: conversation.id,
        message,
      });

      io.to(`user:${assignedToId}`).emit('notification_new_message', {
        conversationId: conversation.id,
        message,
        type: 'TASK_ASSIGNED',
      });
    }

    return { conversation, message };
  } catch (err) {
    console.error('Task notification error:', err);
  }
};