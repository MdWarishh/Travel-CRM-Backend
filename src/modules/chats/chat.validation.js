import { z } from 'zod';

export const createConversationSchema = z.object({
  participantId: z.string().uuid('Invalid participant ID'),
  type: z.enum(['DIRECT', 'GROUP', 'BOOKING', 'LEAD']).default('DIRECT'),
  title: z.string().optional(),
  bookingId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
});

export const sendMessageSchema = z.object({
  messageText: z.string().min(1).optional(),
  messageType: z.enum(['TEXT', 'SYSTEM', 'TASK', 'FILE', 'IMAGE']).default('TEXT'),
  attachmentUrl: z.string().url().optional(),
  metadata: z.record(z.any()).optional(),
});

export const getMessagesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.string().optional(), 
});