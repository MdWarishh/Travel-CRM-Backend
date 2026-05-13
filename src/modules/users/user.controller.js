import * as userService from './user.service.js';
import {
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
  resetPasswordSchema,
  createRoleSchema,
  updateRoleSchema,
  updatePermissionsSchema,
  userQuerySchema,
  activityLogQuerySchema,
} from './user.validation.js';
import { ApiResponse } from '../../utils/helpers.js';

// ═════════════════════════════════════════════════════════════════════════════
// USER CONTROLLERS
// ═════════════════════════════════════════════════════════════════════════════

export const getAllUsers = async (req, res) => {
  const query = userQuerySchema.parse(req.query);
  const result = await userService.getAllUsers(query);
  return ApiResponse.paginated(res, result.users, result.pagination);
};

export const getUserById = async (req, res) => {
  const user = await userService.getUserById(req.params.id);
  return ApiResponse.success(res, user);
};

export const createUser = async (req, res) => {
  const data = createUserSchema.parse(req.body);
  const user = await userService.createUser(data, req.user.id);
  return ApiResponse.created(res, user, 'User created successfully');
};

export const updateUser = async (req, res) => {
  const data = updateUserSchema.parse(req.body);
  const user = await userService.updateUser(req.params.id, data, req.user.id);
  return ApiResponse.success(res, user, 'User updated successfully');
};

export const toggleUserStatus = async (req, res) => {
  const user = await userService.toggleUserStatus(req.params.id, req.user.id);
  return ApiResponse.success(
    res,
    user,
    `User ${user.status === 'ACTIVE' ? 'activated' : 'deactivated'} successfully`
  );
};

export const deleteUser = async (req, res) => {
  await userService.deleteUser(req.params.id, req.user.id);
  return ApiResponse.success(res, null, 'User deleted successfully');
};

export const changePassword = async (req, res) => {
  const data = changePasswordSchema.parse(req.body);
  // Allow user to change own password, or admin to change anyone's
  const targetId = req.user.role === 'ADMIN' && req.params.id ? req.params.id : req.user.id;
  await userService.changePassword(targetId, data);
  return ApiResponse.success(res, null, 'Password changed successfully');
};

export const getUserStats = async (req, res) => {
  const stats = await userService.getUserStats();
  return ApiResponse.success(res, stats);
};

export const getMyProfile = async (req, res) => {
  const user = await userService.getUserById(req.user.id);
  return ApiResponse.success(res, user);
};

export const updateMyProfile = async (req, res) => {
  // Strip out role/status — user can't change their own role
  const { role, status, ...rest } = req.body;
  const data = updateUserSchema.pick({ name: true, phone: true, profileImage: true, department: true }).parse(rest);
  const user = await userService.updateUser(req.user.id, data, req.user.id);
  return ApiResponse.success(res, user, 'Profile updated successfully');
};

// ═════════════════════════════════════════════════════════════════════════════
// ROLE CONTROLLERS
// ═════════════════════════════════════════════════════════════════════════════

export const getAllRoles = async (req, res) => {
  const roles = await userService.getAllRoles();
  return ApiResponse.success(res, roles);
};

export const getRoleById = async (req, res) => {
  const role = await userService.getRoleById(req.params.id);
  return ApiResponse.success(res, role);
};

export const createRole = async (req, res) => {
  const data = createRoleSchema.parse(req.body);
  const role = await userService.createCustomRole(data, req.user.id);
  return ApiResponse.created(res, role, 'Role created successfully');
};

export const updateRole = async (req, res) => {
  const data = updateRoleSchema.parse(req.body);
  const role = await userService.updateCustomRole(req.params.id, data, req.user.id);
  return ApiResponse.success(res, role, 'Role updated successfully');
};

export const deleteRole = async (req, res) => {
  await userService.deleteCustomRole(req.params.id, req.user.id);
  return ApiResponse.success(res, null, 'Role deleted successfully');
};

// ═════════════════════════════════════════════════════════════════════════════
// PERMISSION CONTROLLERS
// ═════════════════════════════════════════════════════════════════════════════

export const updateRolePermissions = async (req, res) => {
  const { permissions } = updatePermissionsSchema.parse(req.body);
  const role = await userService.updateRolePermissions(req.params.roleId, permissions, req.user.id);
  return ApiResponse.success(res, role, 'Permissions updated successfully');
};

export const getUserPermissions = async (req, res) => {
  const permissions = await userService.getUserPermissions(req.params.id || req.user.id);
  return ApiResponse.success(res, permissions);
};

export const getMyPermissions = async (req, res) => {
  const permissions = await userService.getUserPermissions(req.user.id);
  return ApiResponse.success(res, permissions);
};

// ═════════════════════════════════════════════════════════════════════════════
// ACTIVITY LOG CONTROLLERS
// ═════════════════════════════════════════════════════════════════════════════

export const getActivityLogs = async (req, res) => {
  const query = activityLogQuerySchema.parse(req.query);
  const result = await userService.getActivityLogs(query);
  return ApiResponse.paginated(res, result.logs, result.pagination);
};

export const getUserActivityLogs = async (req, res) => {
  const query = activityLogQuerySchema.parse({ ...req.query, userId: req.params.id });
  const result = await userService.getActivityLogs(query);
  return ApiResponse.paginated(res, result.logs, result.pagination);
};