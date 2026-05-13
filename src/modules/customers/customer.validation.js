import { z } from 'zod';

// ─────────────────────────────────────────────
// CUSTOMER SCHEMAS
// ─────────────────────────────────────────────

export const createCustomerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email').optional().or(z.literal('')).transform(v => v || null),
  phone: z.string().min(7, 'Phone must be at least 7 digits'),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  passportNumber: z.string().nullable().optional(),
  passportExpiry: z.string().datetime().nullable().optional(),
  travelPreferences: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).optional().default([]),
  // Auto-set when converting from lead
  createdFromLeadId: z.string().uuid().nullable().optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

// ─────────────────────────────────────────────
// WHATSAPP / EMAIL SCHEMAS
// ─────────────────────────────────────────────

export const sendWhatsAppSchema = z.object({
  customerId: z.string().uuid(),
  message: z.string().min(1, 'Message is required'),
  templateId: z.string().uuid().nullable().optional(),
  attachmentUrl: z.string().url().nullable().optional(),
  phone: z.string().optional(), // override phone if needed
});

export const sendEmailSchema = z.object({
  customerId: z.string().uuid(),
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(1, 'Message is required'),
  attachmentUrl: z.string().url().nullable().optional(),
  attachmentName: z.string().nullable().optional(),
  email: z.string().email().optional(), // override email if needed
});

// ─────────────────────────────────────────────
// COMMUNICATION TEMPLATE SCHEMAS
// ─────────────────────────────────────────────

export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required'),
  type: z.enum(['WHATSAPP', 'EMAIL']),
  subject: z.string().optional(), // for email templates
  body: z.string().min(1, 'Template body is required'),
  variables: z.array(z.string()).optional().default([]),
  isDefault: z.boolean().optional().default(false),
});

export const updateTemplateSchema = createTemplateSchema.partial();

// ─────────────────────────────────────────────
// NOTE SCHEMA
// ─────────────────────────────────────────────

export const addNoteSchema = z.object({
  content: z.string().min(1, 'Note content is required'),
  type: z.enum(['GENERAL', 'PREFERENCE', 'INTERNAL']).default('GENERAL'),
});

export const updateNoteSchema = addNoteSchema.partial();