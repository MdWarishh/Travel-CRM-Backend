import { z } from 'zod';

// ─────────────────────────────────────────────
// SUB-SCHEMAS
// ─────────────────────────────────────────────

export const itineraryImageSchema = z.object({
  url: z.string().url('Image URL must be valid'),
  altText: z.string().optional(),
  position: z.number().int().min(0).optional(),
});

export const itineraryDaySchema = z.object({
  dayNumber: z.number().int().positive(),
  date: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.date().optional()
  ),
  title: z.string().optional(),
  description: z.string().optional(),
  imageLayout: z.enum(['IMAGE_TOP', 'IMAGE_RIGHT', 'GRID']).default('IMAGE_TOP'),

  // Legacy fields kept for backward compatibility
  destination: z.string().optional(),
  hotel: z.string().optional(),
  meals: z.string().optional(),
  transfers: z.string().optional(),
  sightseeing: z.string().optional(),
  activities: z.string().optional(),
  notes: z.string().optional(),

  // Images to create/upsert with this day
  images: z.array(itineraryImageSchema).optional(),
});

export const itineraryThemeSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color').optional(),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fontFamily: z.string().optional(),
});

export const itineraryPolicySchema = z.object({
  bookingPolicy: z.string().optional(),
  cancellationPolicy: z.string().optional(),
  paymentTerms: z.string().optional(),
  otherPolicies: z.string().optional(),
});

export const itineraryAccountSchema = z.object({
  bankName: z.string().optional(),
  accountName: z.string().optional(),
  accountNumber: z.string().optional(),
  ifscCode: z.string().optional(),
  upiId: z.string().optional(),
  upiQrImageUrl: z.string().url().optional(),
  isDefault: z.boolean().optional(),
});

export const itineraryThankYouSchema = z.object({
  message: z.string().optional(),
  backgroundImageUrl: z.string().url().optional(),
  companyName: z.string().optional(),
  companyAddress: z.string().optional(),
  companyEmail: z.string().email().optional().or(z.literal('')),
  companyPhone: z.string().optional(),
  companyWebsite: z.string().url().optional().or(z.literal('')),
  findUsText: z.string().optional(),
});

// ─────────────────────────────────────────────
// BASE ITINERARY SCHEMA
// ─────────────────────────────────────────────

const baseItinerarySchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters'),
  customerId: z.string().uuid('Valid customer ID required').optional().nullable(),
  status: z.enum(['DRAFT', 'FINALIZED', 'SENT', 'ARCHIVED']).default('DRAFT'),
  isTemplate: z.boolean().default(false),

  startDate: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.date().optional()
  ),
  endDate: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.date().optional()
  ),

  totalDays: z.number().int().positive().optional(),
  destination: z.string().optional(),
  startPoint: z.string().optional(),
  endPoint: z.string().optional(),
  durationLabel: z.string().optional(),   // e.g. "2N/3D"
  totalPrice: z.number().positive().optional(),
  numberOfTravelers: z.number().int().positive().optional(),
  heroImageUrl: z.string().url().optional(),
  inclusions: z.string().optional(),
  exclusions: z.string().optional(),
  notes: z.string().optional(),

  // Nested upserts
  days: z.array(itineraryDaySchema).optional(),
  theme: itineraryThemeSchema.optional(),
  policies: itineraryPolicySchema.optional(),
  accounts: z.array(itineraryAccountSchema).optional(),
  thankYou: itineraryThankYouSchema.optional(),
});

// ─────────────────────────────────────────────
// EXPORTED SCHEMAS
// ─────────────────────────────────────────────

export const createItinerarySchema = baseItinerarySchema
  .refine(
    (d) => {
      if (d.startDate && d.endDate) return d.endDate >= d.startDate;
      return true;
    },
    { message: 'End date must be after start date', path: ['endDate'] }
  )
  .refine(
    (d) => d.isTemplate || d.customerId,
    { message: 'customerId is required unless itinerary is a template', path: ['customerId'] }
  );

export const updateItinerarySchema = baseItinerarySchema.partial();

export const addDaySchema = itineraryDaySchema;

// PDF generation request — all fields optional, empty body is valid
export const generatePdfSchema = z
  .object({
    leadId: z
      .string()
      .uuid()
      .optional()
      .nullable()
      .transform((v) => v || undefined),
    customerName: z
      .string()
      .optional()
      .nullable()
      .transform((v) => v?.trim() || undefined),
    travelDate: z.coerce.date().optional().nullable().transform((v) => v ?? undefined),
    numberOfTravelers: z
      .union([z.number(), z.string(), z.null()])
      .optional()
      .transform((v) => {
        if (v === null || v === undefined || v === '') return undefined;
        const n = Number(v);
        return isNaN(n) || n < 1 ? undefined : Math.floor(n);
      }),
  })
  .default({});

export const updateStatusSchema = z.object({
  status: z.enum(['DRAFT', 'FINALIZED', 'SENT', 'ARCHIVED']),
});