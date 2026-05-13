import { z } from 'zod';

// ─────────────────────────────────────────────
// PAYMENT SCHEMAS
// ─────────────────────────────────────────────

export const createPaymentSchema = z.object({
  customerId: z.string().uuid('Valid customer ID required'),
  bookingId: z.string().uuid().optional(),
  amount: z.number().positive('Amount must be positive'),
  mode: z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD']).default('CASH'),
  status: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED']).default('UNPAID'),
  dueAmount: z.number().min(0).optional(),
  paidAmount: z.number().min(0).optional(),
  // transactionId not in Payment schema yet — add after running migration
  // transactionId: z.string().optional(),
  notes: z.string().optional(),
  paidAt: z.string().datetime().optional(),
});

export const updatePaymentSchema = createPaymentSchema.partial();

// ─────────────────────────────────────────────
// INVOICE SCHEMAS
// ─────────────────────────────────────────────

export const createInvoiceSchema = z.object({
  paymentId: z.string().uuid('Valid payment ID required'),
  amount: z.number().positive(),
  notes: z.string().optional(),
});

export const createBookingInvoiceSchema = z.object({
  bookingId: z.string().uuid('Valid booking ID required'),
  notes: z.string().optional(),
  discount: z.number().min(0).optional(),
  tax: z.number().min(0).optional(),
});

// ─────────────────────────────────────────────
// EXPORT SCHEMA
// ─────────────────────────────────────────────

export const exportPaymentsSchema = z.object({
  format: z.enum(['csv', 'excel']).default('csv'),
  status: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED']).optional(),
  customerId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  mode: z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD']).optional(),
});

// ─────────────────────────────────────────────
// REMINDER / COMMUNICATION SCHEMAS
// ─────────────────────────────────────────────

export const sendReminderSchema = z.object({
  bookingId: z.string().uuid('Valid booking ID required'),
  channel: z.enum(['WHATSAPP', 'EMAIL']),
  message: z.string().optional(), // editable before sending
  attachInvoice: z.boolean().default(false),
  attachReceipt: z.boolean().default(false),
  paymentId: z.string().uuid().optional(), // for attaching specific receipt
});

export const sendConfirmationSchema = z.object({
  paymentId: z.string().uuid('Valid payment ID required'),
  channel: z.enum(['WHATSAPP', 'EMAIL']),
  message: z.string().optional(), // editable before sending
  attachReceipt: z.boolean().default(true),
});

export const sendInvoiceSchema = z.object({
  invoiceId: z.string().uuid('Valid invoice ID required'),
  channel: z.enum(['WHATSAPP', 'EMAIL']),
  message: z.string().optional(),
});