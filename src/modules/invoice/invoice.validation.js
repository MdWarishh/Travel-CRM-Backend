import { z } from 'zod';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const emptyToNull = z.string().optional().nullable().transform((v) => v?.trim() || null);

const optionalUrl = z
  .string()
  .optional()
  .nullable()
  .transform((v) => v?.trim() || null)
  .refine((v) => {
    if (!v) return true;
    try { new URL(v); return true; } catch { return false; }
  }, 'Invalid URL format');

const optionalGstin = z
  .string()
  .optional()
  .nullable()
  .transform((v) => v?.trim() || null)
  .refine((v) => {
    if (!v) return true;
    return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v);
  }, 'Invalid GSTIN format (e.g. 22AAAAA0000A1Z5)');

const optionalPan = z
  .string()
  .optional()
  .nullable()
  .transform((v) => v?.trim() || null)
  .refine((v) => {
    if (!v) return true;
    return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(v);
  }, 'Invalid PAN format (e.g. AAAAA0000A)');

const flexibleDatetime = z
  .string()
  .optional()
  .nullable()
  .transform((v) => {
    if (!v?.trim()) return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  });

// ─────────────────────────────────────────────
// COMPANY SETTINGS
// ─────────────────────────────────────────────

export const updateCompanySettingsSchema = z.object({
  companyName: z.string().min(1).optional(),
  logoUrl:     optionalUrl,
  tagline:     emptyToNull,
  signatureUrl: z.string().nullable().optional(),

  address:  emptyToNull,
  city:     emptyToNull,
  state:    emptyToNull,
  pincode:  emptyToNull,
  phone:    emptyToNull,
  email:    z.string().email().optional().nullable().transform((v) => v?.trim() || null),
  website:  optionalUrl,

  gstin:     optionalGstin,
  pan:       optionalPan,
  stateCode: emptyToNull,

  bankName:      emptyToNull,
  accountName:   emptyToNull,
  accountNumber: emptyToNull,
  ifscCode:      emptyToNull,
  upiId:         emptyToNull,
  upiQrImageUrl: optionalUrl,

  invoiceNumberFormat: z.enum(['SIMPLE', 'YEARLY']).optional(),
  invoicePrefix:       z.string().max(10).optional(),

  defaultTerms:   emptyToNull,
  defaultNotes:   emptyToNull,
  defaultGstRate: z.number().min(0).max(28).optional(),
  defaultGstType: z.enum(['CGST_SGST', 'IGST', 'NONE']).optional(),
});

export const resetInvoiceNumberSchema = z.object({
  resetTo: z.number().int().min(0).optional().default(0),
});

// ─────────────────────────────────────────────
// INVOICE ITEM
// ─────────────────────────────────────────────

const invoiceItemSchema = z.object({
  description: z.string().min(1, 'Item description is required'),
  hsn:         emptyToNull,
  quantity:    z.number().positive('Quantity must be positive'),
  unit:        emptyToNull,
  price:       z.number().min(0, 'Price cannot be negative'),
});

// ─────────────────────────────────────────────
// CREATE INVOICE
// ─────────────────────────────────────────────

export const createInvoiceSchema = z.object({
  // Links
  customerId: z.string().uuid().optional().nullable().transform((v) => v || null),
  bookingId:  z.string().uuid().optional().nullable().transform((v) => v || null),
  // NEW: optional vendor link — tracks which vendor this invoice relates to
  // When payment is recorded, an OUTGOING UnifiedPayment is auto-created for this vendor
  vendorId:   z.string().uuid().optional().nullable().transform((v) => v || null),

  // Billing
  billingName:    z.string().min(1, 'Billing name is required'),
  billingAddress: emptyToNull,
  billingState:   emptyToNull,
  billingPhone:   emptyToNull,
  billingEmail:   z.string().email().optional().nullable().transform((v) => v?.trim() || null),
  customerGstin:  optionalGstin,

  // Dates
  issueDate: flexibleDatetime,
  dueDate:   flexibleDatetime,

  // Items
  items: z.array(invoiceItemSchema).min(1, 'At least one item is required'),

  // Discount
  discountType:  z.enum(['PERCENT', 'FLAT']).optional().nullable(),
  discountValue: z.number().min(0).optional().nullable(),

  // GST
  gstRate: z.number().min(0).max(28).default(18),
  gstType: z.enum(['CGST_SGST', 'IGST', 'NONE']).default('CGST_SGST'),

  // Content
  notes: emptyToNull,
  terms: emptyToNull,
});

// ─────────────────────────────────────────────
// UPDATE INVOICE
// ─────────────────────────────────────────────

export const updateInvoiceSchema = z.object({
  // Allow updating vendor link on existing invoice
  vendorId:   z.string().uuid().optional().nullable().transform((v) => v || null),

  billingName:    z.string().min(1).optional(),
  billingAddress: emptyToNull,
  billingState:   emptyToNull,
  billingPhone:   emptyToNull,
  billingEmail:   z.string().email().optional().nullable().transform((v) => v?.trim() || null),
  customerGstin:  optionalGstin,

  issueDate: flexibleDatetime,
  dueDate:   flexibleDatetime,

  items: z.array(invoiceItemSchema).min(1).optional(),

  discountType:  z.enum(['PERCENT', 'FLAT']).optional().nullable(),
  discountValue: z.number().min(0).optional().nullable(),

  gstRate: z.number().min(0).max(28).optional(),
  gstType: z.enum(['CGST_SGST', 'IGST', 'NONE']).optional(),

  notes:  emptyToNull,
  terms:  emptyToNull,
  status: z.enum(['DRAFT', 'SENT', 'PAID', 'PARTIAL', 'UNPAID', 'CANCELLED']).optional(),
});

// ─────────────────────────────────────────────
// RECORD PAYMENT
// ─────────────────────────────────────────────

export const recordPaymentSchema = z.object({
  amount:        z.number().positive('Amount must be positive'),
  mode:          z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD']).default('CASH'),
  transactionId: emptyToNull,
  note:          emptyToNull,
  paidAt:        flexibleDatetime,
});

// ─────────────────────────────────────────────
// INVOICE FILTERS / QUERY
// ─────────────────────────────────────────────

export const invoiceQuerySchema = z.object({
  page:       z.string().optional(),
  limit:      z.string().optional(),
  search:     z.string().optional(),
  status:     z.enum(['DRAFT', 'SENT', 'PAID', 'PARTIAL', 'UNPAID', 'CANCELLED']).optional(),
  customerId: z.string().uuid().optional(),
  bookingId:  z.string().uuid().optional(),
  // NEW: filter invoices by vendor
  vendorId:   z.string().uuid().optional(),
  fromDate:   z.string().optional(),
  toDate:     z.string().optional(),
  sort:       z.enum(['newest', 'oldest', 'amount_high', 'amount_low']).optional(),
});