import { z } from 'zod';

export const createConversationSchema = z.object({
  participantId: z.string().optional(),
  participantIds: z.array(z.string()).min(2).optional(),
  type: z.enum(['DIRECT', 'GROUP', 'BOOKING', 'LEAD']).optional(),
  title: z.string().optional(),
  bookingId: z.string().optional(),
  leadId: z.string().optional(),
  customerId: z.string().optional(),
}).refine(data => {
  if (data.type === 'GROUP') return !!data.participantIds?.length;
  return !!data.participantId;
}, { message: 'participantId required for direct, participantIds for group' });


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