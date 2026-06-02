import { z } from 'zod';

// ─── Enums ────────────────────────────────────────────────────────────────────
export const ROLES = ['ADMIN', 'MANAGER', 'AGENT', 'VENDOR'];
export const STATUSES = ['ACTIVE', 'INACTIVE'];

export const MODULES = [
  'dashboard',
  'leads',
  'customers',
  'itinerary',
  'bookings',
  'payments',
  'tasks',
  'users',
  'reports',
  'attendance',
  'chat',
  'vendors',
  'flight_tickets', // ✅ Added
];

export const ACTIONS = ['view', 'create', 'edit', 'delete'];

// ─── User Schemas ─────────────────────────────────────────────────────────────
export const createUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address').toLowerCase(),
  phone: z.string().optional().nullable(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(ROLES).default('AGENT'),
  department: z.string().max(100).optional().nullable(),
  profileImage: z.string().optional().nullable(),
  status: z.enum(STATUSES).default('ACTIVE'),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().toLowerCase().optional(),
  phone: z.string().optional().nullable(),
  role: z.enum(ROLES).optional(),
  department: z.string().max(100).optional().nullable(),
  status: z.enum(STATUSES).optional(),
  profileImage: z.string().optional().nullable(),
  customRoleId: z.string().uuid('Invalid role ID').optional().nullable(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Must contain at least one number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
});

// ─── Role & Permission Schemas ────────────────────────────────────────────────
export const createRoleSchema = z.object({
  name: z
    .string()
    .min(2, 'Role name must be at least 2 characters')
    .max(50)
    .regex(/^[a-zA-Z\s_]+$/, 'Role name can only contain letters, spaces, and underscores'),
  description: z.string().max(255).optional(),
  permissions: z
    .array(
      z.object({
        module: z.enum(MODULES),
        action: z.enum(ACTIONS),
        allowed: z.boolean(),
      })
    )
    .optional()
    .default([]),
});

export const updateRoleSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-zA-Z\s_]+$/)
    .optional(),
  description: z.string().max(255).optional(),
});

export const updatePermissionsSchema = z.object({
  permissions: z.array(
    z.object({
      module: z.enum(MODULES, { errorMap: () => ({ message: 'Invalid module' }) }),
      action: z.enum(ACTIONS, { errorMap: () => ({ message: 'Invalid action' }) }),
      allowed: z.boolean(),
    })
  ),
});

// ─── Query Schemas ────────────────────────────────────────────────────────────
export const userQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  role: z.enum(ROLES).optional(),
  status: z.enum(STATUSES).optional(),
  search: z.string().max(100).optional(),
  department: z.string().optional(),
  sortBy: z.enum(['name', 'email', 'createdAt', 'lastLogin']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const activityLogQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  module: z.enum(MODULES).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});