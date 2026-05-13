import { z } from 'zod';

// ── Valid vendor type values (mirrors VendorServiceType enum) ─────────────────
const VENDOR_TYPES = [
  'HOTEL',
  'TRANSPORT',
  'TOUR_OPERATOR',
  'VISA',
  'GUIDE',
  'AIRLINE',
  'ACTIVITY',
  'OTHER',
];

const VENDOR_STATUS = ['ACTIVE', 'INACTIVE', 'BLACKLISTED'];

// ── Create schema ─────────────────────────────────────────────────────────────
export const createVendorSchema = z.object({
  name: z.string().min(2, 'Vendor name is required'),

  // Multi-type array (at least one required on create)
  types: z
    .array(z.enum(VENDOR_TYPES))
    .min(1, 'At least one vendor type is required')
    .default(['OTHER']),

  // Legacy single type kept for backward compat
  serviceType: z.enum(VENDOR_TYPES).optional(),

  contactPerson: z.string().optional(),
  email: z
    .string()
    .email('Invalid email')
    .optional()
    .or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),

  // Financial & compliance
  gstin: z
    .string()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN')
    .optional()
    .or(z.literal('')),
  pan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN')
    .optional()
    .or(z.literal('')),

  // Bank details
  bankName:      z.string().optional(),
  accountName:   z.string().optional(),
  accountNumber: z.string().optional(),
  ifscCode:      z.string().optional(),
  upiId:         z.string().optional(),

 commissionPercentage: z.number().min(0).max(100).nullable().optional(),
  commissionRate:       z.number().min(0).max(100).optional(), // legacy

  negotiatedRates:   z.string().optional(),
  availabilityNotes: z.string().optional(),
  notes:             z.string().optional(),

  status:      z.enum(VENDOR_STATUS).default('ACTIVE'),
  isPreferred: z.boolean().default(false),
});

// ── Update schema (all fields optional) ──────────────────────────────────────
export const updateVendorSchema = createVendorSchema
  .partial()
  .omit({ types: true })
  .extend({
    types: z.array(z.enum(VENDOR_TYPES)).min(1).optional(),
  });

// ── Change status schema ──────────────────────────────────────────────────────
export const changeStatusSchema = z.object({
  status: z.enum(VENDOR_STATUS),
});

// ── Add note schema ───────────────────────────────────────────────────────────
export const addNoteSchema = z.object({
  content: z.string().min(1, 'Note content is required'),
});

export const updateNoteSchema = z.object({
  content: z.string().min(1, 'Note content is required'),
});

// ── Auto-suggest query schema ─────────────────────────────────────────────────
export const suggestVendorSchema = z.object({
  city: z.string().optional(),
  type: z.enum(VENDOR_TYPES).optional(),
});