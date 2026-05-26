import attendanceService from './attendance.service.js';
import {
  manualAttendanceSchema,
  updateAttendanceSettingsSchema,
  attendanceQuerySchema,
} from './attendance.validation.js';
import { ApiResponse } from '../../utils/helpers.js';

// ─────────────────────────────────────────────
// USER — CHECK IN / CHECK OUT / TODAY
// ─────────────────────────────────────────────

export const checkIn = async (req, res) => {
  const attendance = await attendanceService.checkIn(req.user);
  return ApiResponse.created(res, attendance, 'Checked in successfully');
};

export const checkOut = async (req, res) => {
  const attendance = await attendanceService.checkOut(req.user);
  return ApiResponse.success(res, attendance, 'Checked out successfully');
};

export const getTodayAttendance = async (req, res) => {
  const result = await attendanceService.getTodayAttendance(req.user);
  return ApiResponse.success(res, result);
};

// ─────────────────────────────────────────────
// USER — MY HISTORY
// ─────────────────────────────────────────────

export const getMyAttendance = async (req, res) => {
  const query = attendanceQuerySchema.parse(req.query);
  const result = await attendanceService.getMyAttendance(req.user, query);
  return ApiResponse.paginated(res, result.records, result.pagination);
};

// ─────────────────────────────────────────────
// ADMIN — ALL ATTENDANCE
// ─────────────────────────────────────────────

export const getAllAttendance = async (req, res) => {
  const query = attendanceQuerySchema.parse(req.query);
  const result = await attendanceService.getAllAttendance(query);
  return ApiResponse.paginated(res, result.records, result.pagination);
};

// ─────────────────────────────────────────────
// ADMIN — USER ATTENDANCE (calendar view)
// ─────────────────────────────────────────────

export const getUserAttendance = async (req, res) => {
  const query = attendanceQuerySchema.parse(req.query);
  const result = await attendanceService.getUserAttendance(req.params.userId, query);
  return ApiResponse.success(res, result);
};

// ─────────────────────────────────────────────
// ADMIN — MANUAL OVERRIDE
// ─────────────────────────────────────────────

export const manualOverride = async (req, res) => {
  const data = manualAttendanceSchema.parse(req.body);
  const attendance = await attendanceService.manualOverride(data, req.user);
  return ApiResponse.success(res, attendance, 'Attendance updated');
};

// ─────────────────────────────────────────────
// ADMIN — SETTINGS
// ─────────────────────────────────────────────

export const getSettings = async (req, res) => {
  const settings = await attendanceService.getAttendanceSettings();
  return ApiResponse.success(res, settings);
};

export const updateSettings = async (req, res) => {
  const data = updateAttendanceSettingsSchema.parse(req.body);
  const settings = await attendanceService.updateAttendanceSettings(data, req.user);
  return ApiResponse.success(res, settings, 'Settings updated');
};

// ─────────────────────────────────────────────
// ADMIN — STATS
// ─────────────────────────────────────────────

export const getStats = async (req, res) => {
  const query = attendanceQuerySchema.parse(req.query);
  const stats = await attendanceService.getAttendanceStats(query);
  return ApiResponse.success(res, stats);
};

// ─────────────────────────────────────────────
// CRON — AUTO ABSENT (call from your cron job file)
// ─────────────────────────────────────────────

export const triggerAutoAbsent = async (req, res) => {
  const result = await attendanceService.markAbsentForToday();
  return ApiResponse.success(res, result, `Marked ${result.marked} users as absent`);
};