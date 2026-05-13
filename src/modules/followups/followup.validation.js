import { z } from 'zod';

export const createFollowUpSchema = z.object({
  leadId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),

  type: z.enum(['CALL', 'MESSAGE', 'MEETING', 'EMAIL']).default('CALL'),

  // ✅ FIX
  dueAt: z.coerce.date(),

  notes: z.string().optional(),
});

export const updateFollowUpSchema = z.object({
  type: z.enum(['CALL', 'MESSAGE', 'MEETING', 'EMAIL']).optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'MISSED']).optional(),

  // ✅ FIX
  dueAt: z.coerce.date().optional(),

  notes: z.string().optional(),
});