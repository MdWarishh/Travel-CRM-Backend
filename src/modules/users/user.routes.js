import { Router } from 'express';
import * as userController from './user.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─── My Profile (self) ────────────────────────────────────────────────────────
router.get('/me', userController.getMyProfile);
router.put('/me', userController.updateMyProfile);
router.get('/me/permissions', userController.getMyPermissions);
router.patch('/me/change-password', userController.changePassword);

// ─── User Stats ───────────────────────────────────────────────────────────────
router.get('/stats', authorize('ADMIN', 'MANAGER'), userController.getUserStats);

// ─── Activity Logs ────────────────────────────────────────────────────────────
router.get(
  '/activity-logs',
  authorize('ADMIN', 'MANAGER'),
  userController.getActivityLogs
);

// ─── Users CRUD ───────────────────────────────────────────────────────────────
// GET  /api/v1/users           - List users  (Admin + Manager)
router.get(
  '/',
  requirePermission('users', 'view'),
  userController.getAllUsers
);

// POST /api/v1/users           - Create user (Admin only)
router.post(
  '/',
  authorize('ADMIN'),
  userController.createUser
);

// GET  /api/v1/users/:id       - Get user by ID (Admin + Manager)
router.get(
  '/:id',
  requirePermission('users', 'view'),
  userController.getUserById
);

// PUT  /api/v1/users/:id       - Update user (Admin only)
router.put(
  '/:id',
  authorize('ADMIN'),
  userController.updateUser
);

// PATCH /api/v1/users/:id/toggle-status - Enable/Disable user (Admin only)
router.patch(
  '/:id/toggle-status',
  authorize('ADMIN'),
  userController.toggleUserStatus
);

// PATCH /api/v1/users/:id/change-password - Admin changes password for a user
router.patch(
  '/:id/change-password',
  authorize('ADMIN'),
  userController.changePassword
);

// DELETE /api/v1/users/:id     - Delete user (Admin only)
router.delete(
  '/:id',
  authorize('ADMIN'),
  userController.deleteUser
);

// GET /api/v1/users/:id/permissions - Get user's resolved permissions
router.get(
  '/:id/permissions',
  authorize('ADMIN', 'MANAGER'),
  userController.getUserPermissions
);

// GET /api/v1/users/:id/activity - User-specific activity log
router.get(
  '/:id/activity',
  authorize('ADMIN', 'MANAGER'),
  userController.getUserActivityLogs
);

// ─── Roles ────────────────────────────────────────────────────────────────────
// GET  /api/v1/users/roles     - All roles (Admin + Manager)
router.get(
  '/roles/all',
  authorize('ADMIN', 'MANAGER'),
  userController.getAllRoles
);

// POST /api/v1/users/roles     - Create custom role (Admin only)
router.post(
  '/roles',
  authorize('ADMIN'),
  userController.createRole
);

// GET  /api/v1/users/roles/:id
router.get(
  '/roles/:id',
  authorize('ADMIN', 'MANAGER'),
  userController.getRoleById
);

// PUT  /api/v1/users/roles/:id
router.put(
  '/roles/:id',
  authorize('ADMIN'),
  userController.updateRole
);

// DELETE /api/v1/users/roles/:id
router.delete(
  '/roles/:id',
  authorize('ADMIN'),
  userController.deleteRole
);

// ─── Permissions ──────────────────────────────────────────────────────────────
// PUT /api/v1/users/roles/:roleId/permissions  - Update permission matrix
router.put(
  '/roles/:roleId/permissions',
  authorize('ADMIN'),
  userController.updateRolePermissions
);

export default router;