import { z } from 'zod';

// ═════════════════════════════════════════════════════════════════════════════
// LEAD
// ═════════════════════════════════════════════════════════════════════════════

export const createLeadSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().min(7, 'Valid phone is required'),
  source: z.enum(['WEBSITE', 'MANUAL', 'WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'MESSENGER', 'PHONE', 'OTHER']).default('MANUAL'),
  stageId: z.string().uuid().optional(),
  priority: z.enum(['HOT', 'WARM', 'COLD']).default('WARM'),
  destination: z.string().optional(),
  estimatedBudget: z.number().positive().optional(),
  travelDate: z.string().optional(),
  numberOfTravelers: z.number().int().positive().optional(),
  notes: z.string().optional(),
  assignedToId: z.string().uuid().optional(),
});

export const updateLeadSchema = createLeadSchema.partial();

export const addLeadNoteSchema = z.object({
  content: z.string().min(1, 'Note content is required'),
});

export const assignLeadSchema = z.object({
  assignedToId: z.string().uuid('Invalid agent ID'),
});

// ═════════════════════════════════════════════════════════════════════════════
// FOLLOW-UPS
// ═════════════════════════════════════════════════════════════════════════════

export const createFollowUpSchema = z.object({
  type: z.enum(['CALL', 'MESSAGE', 'MEETING', 'EMAIL']),
  dueAt: z.string().min(1, 'Due date is required'),
  notes: z.string().optional(),
  assignedToId: z.string().uuid().optional(),
});

export const updateFollowUpSchema = z.object({
  type: z.enum(['CALL', 'MESSAGE', 'MEETING', 'EMAIL']).optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'MISSED']).optional(),
  dueAt: z.string().optional(),
  notes: z.string().optional(),
  assignedToId: z.string().uuid().optional(),
});

// ═════════════════════════════════════════════════════════════════════════════
// TASKS
// ═════════════════════════════════════════════════════════════════════════════

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  dueAt: z.string().optional(),
  assignedToId: z.string().uuid().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  dueAt: z.string().optional(),
  assignedToId: z.string().uuid().optional().nullable(),
});

// ═════════════════════════════════════════════════════════════════════════════
// MEETINGS
// ═════════════════════════════════════════════════════════════════════════════

export const createMeetingSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  scheduledAt: z.string().min(1, 'Scheduled date is required'),
  duration: z.number().int().positive().optional(),
  location: z.string().optional(),
  meetingLink: z.string().url().optional().or(z.literal('')),
  notes: z.string().optional(),
  assignedToId: z.string().uuid().optional(),
});

export const updateMeetingSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
  scheduledAt: z.string().optional(),
  duration: z.number().int().positive().optional().nullable(),
  location: z.string().optional().nullable(),
  meetingLink: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
});

// ═════════════════════════════════════════════════════════════════════════════
// LABELS
// ═════════════════════════════════════════════════════════════════════════════

export const createLabelSchema = z.object({
  name: z.string().min(1, 'Label name is required'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color').default('#6366f1'),
});

// ═════════════════════════════════════════════════════════════════════════════
// QUOTATIONS & INVOICES (shared item schema)
// ═════════════════════════════════════════════════════════════════════════════

const lineItemSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  quantity: z.number().int().positive().default(1),
  unitPrice: z.number().nonnegative('Price must be 0 or more'),
});

export const createQuotationSchema = z.object({
  items: z.array(lineItemSchema).min(1, 'At least one item is required'),
  discount: z.number().nonnegative().optional().default(0),
  tax: z.number().nonnegative().optional().default(0),
  notes: z.string().optional(),
  termsConditions: z.string().optional(),
  validUntil: z.string().optional(),
});

export const updateQuotationSchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']).optional(),
  items: z.array(lineItemSchema).optional(),
  discount: z.number().nonnegative().optional(),
  tax: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  termsConditions: z.string().optional(),
  validUntil: z.string().optional(),
});

export const createInvoiceSchema = z.object({
  items: z.array(lineItemSchema).min(1, 'At least one item is required'),
  discount: z.number().nonnegative().optional().default(0),
  tax: z.number().nonnegative().optional().default(0),
  notes: z.string().optional(),
  dueDate: z.string().optional(),
});

export const updateInvoiceSchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'PAID', 'CANCELLED']).optional(),
  items: z.array(lineItemSchema).optional(),
  discount: z.number().nonnegative().optional(),
  tax: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  dueDate: z.string().optional(),
  paidAmount: z.number().nonnegative().optional(),
});