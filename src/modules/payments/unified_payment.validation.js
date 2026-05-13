import { z } from 'zod';

// ─────────────────────────────────────────────
// MANUAL PAYMENT CREATE
// ─────────────────────────────────────────────

export const createUnifiedPaymentSchema = z.object({
  type: z.enum(['INCOMING', 'OUTGOING']),

  // At least one party required
  customerId: z.string().uuid().optional(),
  vendorId:   z.string().uuid().optional(),

  // Optional source links
  bookingId:  z.string().uuid().optional(),
  invoiceId:  z.string().uuid().optional(),
  dealId:     z.string().uuid().optional(),

  amount:    z.number().positive('Amount must be positive'),
  method:    z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD']).default('CASH'),
  status:    z.enum(['PAID', 'PENDING', 'PARTIAL', 'UNPAID', 'REFUNDED']).default('PAID'),
  reference: z.string().optional(),
  note:      z.string().optional(),
  paidAt:    z.string().datetime().optional(),
}).refine(
  (data) => data.customerId || data.vendorId,
  { message: 'Either customerId or vendorId is required', path: ['customerId'] }
);

// ─────────────────────────────────────────────
// UPDATE (partial)
// ─────────────────────────────────────────────

export const updateUnifiedPaymentSchema = z.object({
  type:      z.enum(['INCOMING', 'OUTGOING']).optional(),
  amount:    z.number().positive().optional(),
  method:    z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD']).optional(),
  status:    z.enum(['PAID', 'PENDING', 'PARTIAL', 'UNPAID', 'REFUNDED']).optional(),
  reference: z.string().optional(),
  note:      z.string().optional(),
  paidAt:    z.string().datetime().optional(),
  customerId: z.string().uuid().optional(),
  vendorId:   z.string().uuid().optional(),
});

// ─────────────────────────────────────────────
// FILTERS (GET ALL)
// ─────────────────────────────────────────────

export const getUnifiedPaymentsSchema = z.object({
  page:       z.string().optional(),
  limit:      z.string().optional(),
  type:       z.enum(['INCOMING', 'OUTGOING']).optional(),
  source:     z.enum(['BOOKING', 'INVOICE', 'TICKET', 'MANUAL']).optional(),
  status:     z.enum(['PAID', 'PENDING', 'PARTIAL', 'UNPAID', 'REFUNDED']).optional(),
  method:     z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD']).optional(),
  customerId: z.string().uuid().optional(),
  vendorId:   z.string().uuid().optional(),
  bookingId:  z.string().uuid().optional(),
  dealId:     z.string().uuid().optional(),
  startDate:  z.string().datetime().optional(),
  endDate:    z.string().datetime().optional(),
  search:     z.string().optional(),
  sort:       z.enum(['latest', 'oldest', 'highest', 'lowest']).default('latest'),
});

// ─────────────────────────────────────────────
// EXPORT FILTERS
// ─────────────────────────────────────────────

export const exportUnifiedPaymentsSchema = z.object({
  format:     z.enum(['csv', 'excel']).default('csv'),
  type:       z.enum(['INCOMING', 'OUTGOING']).optional(),
  source:     z.enum(['BOOKING', 'INVOICE', 'TICKET', 'MANUAL']).optional(),
  status:     z.enum(['PAID', 'PENDING', 'PARTIAL', 'UNPAID', 'REFUNDED']).optional(),
  method:     z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD']).optional(),
  customerId: z.string().uuid().optional(),
  vendorId:   z.string().uuid().optional(),
  startDate:  z.string().datetime().optional(),
  endDate:    z.string().datetime().optional(),
});