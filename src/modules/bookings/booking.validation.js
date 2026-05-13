import { z } from 'zod';

// ─── Booking Item ──────────────────────────────
const bookingItemSchema = z.object({
  type: z.string().min(1),
  description: z.string().optional(),
  vendorId: z.string().uuid().optional(),
  referenceNumber: z.string().optional(),
  amount: z.number().positive().optional(),
  status: z
    .enum(['PENDING', 'REQUESTED', 'CONFIRMED', 'CANCELLED', 'COMPLETED'])
    .default('PENDING'),
  notes: z.string().optional(),
});

// ─── Create Booking ────────────────────────────
export const createBookingSchema = z.object({
  customerId: z.string().uuid('Valid customer ID required'),
  itineraryId: z.string().uuid().optional().or(z.literal('')),
  status: z
    .enum([
      'DRAFT', 'PENDING', 'REQUESTED', 'CONFIRMED',
      'VOUCHER_SENT', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
    ])
    .default('DRAFT'),
  travelStart: z.string().optional(),
  travelEnd: z.string().optional(),
  adults: z.number().int().min(1).optional(),
  children: z.number().int().min(0).optional(),
  childAge: z.string().optional(),
  pricePerAdult: z.number().positive().optional(),
  pricePerChild: z.number().min(0).optional(),
  totalAmount: z.number().positive().optional(),
  advancePaid: z.number().min(0).optional(),
  notes: z.string().optional(),
  startDetails: z.string().optional(),
  endDetails: z.string().optional(),
  tourDays: z.string().optional(),
  inclusions: z.string().optional(),
  dayWiseItinerary: z.string().optional(),
  companyLogoUrl: z.string().optional(),
  items: z.array(bookingItemSchema).optional(),
});

export const updateBookingSchema = createBookingSchema.partial();
export const addBookingItemSchema = bookingItemSchema;

// ─── Hotel ─────────────────────────────────────
// vendorId added — optional, must be a valid UUID if provided
export const hotelBookingSchema = z.object({
  city: z.string().min(1),
  hotelName: z.string().min(1),
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
  rooms: z.number().int().min(1).default(1),
  roomType: z.enum(['STANDARD', 'DELUXE', 'SUITE']).default('STANDARD'),
  mealPlan: z.enum(['CP', 'MAP', 'AP', 'EP']).default('CP'),
  guests: z.number().int().min(1).default(1),
  extraBed: z.boolean().default(false),
  notes: z.string().optional(),
  // ── NEW ──
  vendorId: z.string().uuid('Invalid vendor ID').optional().nullable(),
  vendorCost: z.number().min(0).optional(),  // what we pay vendor
});

// ─── Flight ────────────────────────────────────
// vendorId added — optional, must be a valid UUID if provided
export const flightBookingSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  departure: z.string().min(1),
  arrival: z.string().min(1),
  airline: z.string().optional(),
  flightNumber: z.string().optional(),
  pnr: z.string().optional(),
  travelClass: z.enum(['ECONOMY', 'BUSINESS', 'FIRST']).default('ECONOMY'),
  baggage: z.string().optional(),
  status: z.enum(['BOOKED', 'PENDING', 'CANCELLED']).default('PENDING'),
  notes: z.string().optional(),
  // ── NEW ──
  vendorId: z.string().uuid('Invalid vendor ID').optional().nullable(),
  vendorCost: z.number().min(0).optional(),
});

// ─── Transport ─────────────────────────────────
// vendorId added — optional, must be a valid UUID if provided
export const transportBookingSchema = z.object({
  vehicleType: z.string().min(1),
  pickup: z.string().min(1),
  drop: z.string().min(1),
  datetime: z.string().min(1),
  driverName: z.string().optional(),
  driverPhone: z.string().optional(),
  transportType: z.enum(['PRIVATE', 'SHARED']).default('PRIVATE'),
  days: z.number().int().min(1).optional(),
  included: z.boolean().default(false),
  notes: z.string().optional(),
  // ── NEW ──
  vendorId: z.string().uuid('Invalid vendor ID').optional().nullable(),
  vendorCost: z.number().min(0).optional(),
});

// ─── Task ──────────────────────────────────────
export const addTaskSchema = z.object({
  title: z.string().min(1, 'Task title required'),
});

// ─── Traveller ─────────────────────────────────
export const addTravellerSchema = z.object({
  name: z.string().min(1, 'Name required'),
  age: z.number().int().min(0).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  idProof: z.string().optional(),
});

// ─── Day ───────────────────────────────────────
export const updateDaySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']).optional(),
  notes: z.string().optional(),
});

// ─── Payment ───────────────────────────────────
export const addPaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  mode: z.string().min(1, 'Payment mode required'),
  note: z.string().optional(),
  paidAt: z.string().optional(),
});

// ─── Log ───────────────────────────────────────
export const addLogSchema = z.object({
  message: z.string().min(1, 'Message required'),
});

// ─── Vendor filter (for dropdown endpoint) ─────
export const vendorTypeQuerySchema = z.object({
  type: z.enum([
    'HOTEL', 'TRANSPORT', 'TOUR_OPERATOR', 'VISA',
    'GUIDE', 'AIRLINE', 'ACTIVITY', 'OTHER',
  ]),
});