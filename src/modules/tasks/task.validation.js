import { z } from 'zod';

// ═════════════════════════════════════════════════════════════════════════════
// TASK
// ═════════════════════════════════════════════════════════════════════════════

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  type: z.enum(['TASK', 'MEETING', 'FOLLOW_UP']).default('TASK'),
  relatedToType: z.enum(['LEAD', 'CUSTOMER', 'BOOKING']).optional(),
  relatedToId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  dueDateTime: z.string().min(1, 'Due date & time is required'),
  reminderBeforeMinutes: z.number().int().min(0).default(30),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  type: z.enum(['TASK', 'MEETING', 'FOLLOW_UP']).optional(),
  relatedToType: z.enum(['LEAD', 'CUSTOMER', 'BOOKING']).optional().nullable(),
  relatedToId: z.string().uuid().optional().nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
  dueDateTime: z.string().optional(),
  reminderBeforeMinutes: z.number().int().min(0).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']).optional(),
});

export const updateTaskStatusSchema = z.object({
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']),
});