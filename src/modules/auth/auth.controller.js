import authService from './auth.service.js';
import { loginSchema, changePasswordSchema } from './auth.validation.js';
import { ApiResponse } from '../../utils/helpers.js';

export const login = async (req, res) => {
  const data = loginSchema.parse(req.body);
  const result = await authService.login(data);
  return ApiResponse.success(res, result, 'Login successful');
};

export const getMe = async (req, res) => {
  const user = await authService.getMe(req.user.id);
  return ApiResponse.success(res, user);
};

export const logout = async (req, res) => {
  // JWT is stateless — client deletes token
  return ApiResponse.success(res, null, 'Logged out successfully');
};

export const changePassword = async (req, res) => {
  const data = changePasswordSchema.parse(req.body);
  await authService.changePassword(req.user.id, data);
  return ApiResponse.success(res, null, 'Password changed successfully');
};