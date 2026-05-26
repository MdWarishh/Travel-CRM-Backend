import { z } from 'zod';

// ─────────────────────────────────────────────
// ATTENDANCE SCHEMAS
// ─────────────────────────────────────────────

export const checkInSchema = z.object({
  // No body required — userId from req.user, time from server
});

export const checkOutSchema = z.object({
  // No body required — userId from req.user, time from server
});

// Admin manual override
export const manualAttendanceSchema = z.object({
  userId: z.string().uuid(),
  date: z.string().datetime(),
  checkInTime: z.string().datetime().nullable().optional(),
  checkOutTime: z.string().datetime().nullable().optional(),
  status: z.enum(['PRESENT', 'HALF_DAY', 'ABSENT']).optional(),
  note: z.string().optional(),
});

// Admin settings update
export const updateAttendanceSettingsSchema = z.object({
  minimumWorkingHours: z
    .number()
    .min(0)
    .max(24)
    .nullable()
    .optional(),
  fullDayHours: z
    .number()
    .min(1)
    .max(24)
    .default(8),
});

// Query filters
export const attendanceQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  month: z.coerce.number().min(1).max(12).optional(), // 1–12
  year: z.coerce.number().min(2020).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  status: z.enum(['PRESENT', 'HALF_DAY', 'ABSENT']).optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(25),
});