import { z } from 'zod';

// ─── Reusable validators ──────────────────────────────────────────────────────
const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be HH:MM format (e.g. 14:30)');

const sourceChannel = z
  .enum(['EMAIL', 'WHATSAPP', 'PHONE', 'WALK_IN', 'ONLINE'])
  .optional();

const paymentMethod = z
  .enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CARD'])
  .optional();

const ticketClass = z
  .enum(['ECONOMY', 'BUSINESS', 'FIRST'])
  .optional();

// ✅ coerce.number() — form se string aaye to bhi number ban jaayega
// nonnegative() use kiya positive() ki jagah — 0 bhi valid hai edge case mein
const positiveNum  = z.coerce.number({ invalid_type_error: 'Must be a number' }).positive('Must be greater than 0');
const nonNegNum    = z.coerce.number({ invalid_type_error: 'Must be a number' }).nonnegative('Must be 0 or more');
const positiveInt  = z.coerce.number({ invalid_type_error: 'Must be a number' }).int().positive('Must be a positive integer');

// ═════════════════════════════════════════════════════════════════════════════
// TICKET SELLER
// ═════════════════════════════════════════════════════════════════════════════

export const createSellerSchema = z.object({
  // Core (required)
  brokerName:     z.string().min(2, 'Broker name is required'),
  phone:          z.string().min(7, 'Valid phone number is required'),
  fromCity:       z.string().min(2, 'From city is required'),
  toCity:         z.string().min(2, 'To city is required'),
  departureTime:  timeString,
  arrivalTime:    timeString,
  travelDate:     z.string().min(1, 'Travel date is required'),
  seatsAvailable: positiveInt,
  pricePerSeat:   positiveNum,  // ✅ coerce — form string → number

  // Optional contact
  email:          z.string().email().optional().or(z.literal('')),

  // Airline & booking details
  airline:        z.string().optional(),
  flightNumber:   z.string().optional(),
  bookingRef:     z.string().optional(),
  ticketClass:    ticketClass,
  pnr:            z.string().optional(),

  // Purchase tracking
  purchasePrice:  positiveNum.optional(),
  purchasedFrom:  z.string().optional(),
  purchasedAt:    z.string().optional(),

  // Source
  sourceChannel:  sourceChannel,
  emailSource:    z.string().optional(),

  notes:          z.string().optional(),
});

export const updateSellerSchema = createSellerSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ═════════════════════════════════════════════════════════════════════════════
// TICKET BUYER
// ═════════════════════════════════════════════════════════════════════════════

export const createBuyerSchema = z.object({
  // Core (required)
  brokerName:        z.string().min(2, 'Broker name is required'),
  phone:             z.string().min(7, 'Valid phone number is required'),
  fromCity:          z.string().min(2, 'From city is required'),
  toCity:            z.string().min(2, 'To city is required'),
  preferredTimeFrom: timeString,
  preferredTimeTo:   timeString,
  travelDate:        z.string().min(1, 'Travel date is required'),
  seatsRequired:     positiveInt,  // ✅ coerce
  budgetPerSeat:     positiveNum,  // ✅ coerce

  // Optional contact
  email:             z.string().email().optional().or(z.literal('')),

  // Passenger details
  passengerCount:    positiveInt.optional(),
  passengerNames:    z.string().optional(),

  // Payment tracking
  agreedPricePerSeat: positiveNum.optional(),
  totalCollected:     nonNegNum.optional(),
  paymentMethod:      paymentMethod,
  paymentStatus:      z.enum(['PENDING', 'PARTIAL', 'PAID']).optional(),
  paymentDate:        z.string().optional(),
  paymentRef:         z.string().optional(),

  // Source
  sourceChannel:     sourceChannel,
  emailSource:       z.string().optional(),

  notes:             z.string().optional(),
});

export const updateBuyerSchema = createBuyerSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ═════════════════════════════════════════════════════════════════════════════
// TICKET DEAL
// ═════════════════════════════════════════════════════════════════════════════

export const createDealSchema = z.object({
  sellerId:           z.string().uuid('Invalid seller ID'),
  buyerId:            z.string().uuid('Invalid buyer ID'),

  seatsBooked:        positiveInt.optional(),
  sellerCostPerSeat:  nonNegNum.optional(),
  buyerPricePerSeat:  nonNegNum.optional(),
  commission:         nonNegNum.optional(),

  paymentStatus:      z.enum(['PENDING', 'PARTIAL', 'RECEIVED']).optional(),
  paymentRef:         z.string().optional(),

  adminNotes:         z.string().optional(),
});

export const updateDealSchema = z.object({
  status:             z.enum(['PENDING', 'CONNECTED', 'COMPLETED', 'REJECTED']).optional(),

  seatsBooked:        positiveInt.optional(),
  sellerCostPerSeat:  nonNegNum.optional(),
  buyerPricePerSeat:  nonNegNum.optional(),
  commission:         nonNegNum.optional(),

  totalRevenue:       nonNegNum.optional(),
  totalCost:          nonNegNum.optional(),
  grossProfit:        z.coerce.number().optional(),

  paymentStatus:      z.enum(['PENDING', 'PARTIAL', 'RECEIVED']).optional(),
  paymentReceivedAt:  z.string().optional(),
  paymentRef:         z.string().optional(),

  bookingConfirmed:   z.boolean().optional(),
  confirmationRef:    z.string().optional(),
  ticketsSent:        z.boolean().optional(),

  adminNotes:         z.string().optional(),
});

// ═════════════════════════════════════════════════════════════════════════════
// PAYMENT ENTRY
// ═════════════════════════════════════════════════════════════════════════════

export const createPaymentSchema = z.object({
  type:      z.enum(['RECEIVED', 'PAID']),
  amount:    positiveNum,  // ✅ coerce
  method:    z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CARD']).optional(),
  reference: z.string().optional(),
  paidAt:    z.string().optional(),
  notes:     z.string().optional(),
});

// ═════════════════════════════════════════════════════════════════════════════
// AGENT PERMISSIONS
// ═════════════════════════════════════════════════════════════════════════════

export const agentPermissionSchema = z.object({
  userId: z.string().uuid(),

  canViewSellers:   z.boolean().optional(),
  canAddSellers:    z.boolean().optional(),
  canEditSellers:   z.boolean().optional(),
  canDeleteSellers: z.boolean().optional(),

  canViewBuyers:    z.boolean().optional(),
  canAddBuyers:     z.boolean().optional(),
  canEditBuyers:    z.boolean().optional(),
  canDeleteBuyers:  z.boolean().optional(),

  canViewDeals:     z.boolean().optional(),
  canAddDeals:      z.boolean().optional(),
  canEditDeals:     z.boolean().optional(),
  canDeleteDeals:   z.boolean().optional(),

  canViewReports:   z.boolean().optional(),
  canImportData:    z.boolean().optional(),
});

// ═════════════════════════════════════════════════════════════════════════════
// BULK IMPORT
// ═════════════════════════════════════════════════════════════════════════════

export const bulkImportSchema = z.object({
  type:        z.enum(['SELLER', 'BUYER']),
  source:      z.enum(['EMAIL', 'CSV', 'MANUAL']).default('MANUAL'),
  sourceEmail: z.string().optional(),
  importBatch: z.string().optional(),
  records:     z.array(z.record(z.unknown())).min(1, 'At least one record required'),
});