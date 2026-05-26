import prisma from '../../config/db.js';
import { AppError, getPagination, buildPaginationMeta } from '../../utils/helpers.js';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Get start-of-day (UTC midnight) for a given date.
 * Attendance records are keyed by date at 00:00:00.000Z
 */
const startOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Calculate total working hours between two Date objects.
 * Returns float rounded to 2 decimal places.
 */
const calcHours = (checkIn, checkOut) => {
  const ms = new Date(checkOut) - new Date(checkIn);
  return Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
};

/**
 * Derive status from totalHours.
 * Uses fullDayHours from settings (default 8).
 */
const deriveStatus = (totalHours, fullDayHours = 8) => {
  if (totalHours === null || totalHours === undefined) return 'ABSENT';
  if (totalHours >= fullDayHours) return 'PRESENT';
  if (totalHours > 0) return 'HALF_DAY';
  return 'ABSENT';
};

/**
 * Get (or create) the single AttendanceSettings row.
 */
const getSettings = async () => {
  let settings = await prisma.attendanceSettings.findFirst();
  if (!settings) {
    settings = await prisma.attendanceSettings.create({
      data: { fullDayHours: 8, minimumWorkingHours: null },
    });
  }
  return settings;
};

// ─────────────────────────────────────────────
// CHECK IN
// ─────────────────────────────────────────────

const checkIn = async (requestingUser) => {
  const today = startOfDay();
  const now = new Date();

  // Check if already checked in today
  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId: requestingUser.id, date: today } },
  });

  if (existing && existing.checkInTime) {
    throw new AppError('Already checked in for today', 409);
  }

  const attendance = await prisma.attendance.upsert({
    where: { userId_date: { userId: requestingUser.id, date: today } },
    create: {
      userId: requestingUser.id,
      date: today,
      checkInTime: now,
      status: 'ABSENT', // Will update on checkout
    },
    update: {
      checkInTime: now,
    },
  });

  return attendance;
};

// ─────────────────────────────────────────────
// CHECK OUT
// ─────────────────────────────────────────────

const checkOut = async (requestingUser) => {
  const today = startOfDay();
  const now = new Date();

  // Must have checked in first
  const attendance = await prisma.attendance.findUnique({
    where: { userId_date: { userId: requestingUser.id, date: today } },
  });

  if (!attendance || !attendance.checkInTime) {
    throw new AppError('You have not checked in today', 400);
  }

  if (attendance.checkOutTime) {
    throw new AppError('Already checked out for today', 409);
  }

  // ── Minimum hours restriction ──
  const settings = await getSettings();

  if (settings.minimumWorkingHours) {
    const allowedCheckoutTime = new Date(
      new Date(attendance.checkInTime).getTime() +
        settings.minimumWorkingHours * 60 * 60 * 1000
    );

    if (now < allowedCheckoutTime) {
      const remainingMs = allowedCheckoutTime - now;
      const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
      const h = Math.floor(remainingMinutes / 60);
      const m = remainingMinutes % 60;

      throw new AppError(
        `Early checkout not allowed. Minimum ${settings.minimumWorkingHours}h required. ` +
          `Checkout available at ${allowedCheckoutTime.toISOString()}. ` +
          `Remaining: ${h}h ${m}m`,
        403,
        {
          allowedCheckoutTime: allowedCheckoutTime.toISOString(),
          remainingMinutes,
        }
      );
    }
  }

  // Calculate hours & derive status
  const totalHours = calcHours(attendance.checkInTime, now);
  const status = deriveStatus(totalHours, settings.fullDayHours);

  const updated = await prisma.attendance.update({
    where: { id: attendance.id },
    data: {
      checkOutTime: now,
      totalHours,
      status,
    },
  });

  return updated;
};

// ─────────────────────────────────────────────
// GET TODAY'S ATTENDANCE (for current user)
// ─────────────────────────────────────────────

const getTodayAttendance = async (requestingUser) => {
  const today = startOfDay();

  const attendance = await prisma.attendance.findUnique({
    where: { userId_date: { userId: requestingUser.id, date: today } },
  });

  const settings = await getSettings();

  // Compute allowedCheckoutTime if checked in and min hours set
  let allowedCheckoutTime = null;
  let remainingMinutes = null;
  const now = new Date();

  if (attendance?.checkInTime && settings.minimumWorkingHours) {
    allowedCheckoutTime = new Date(
      new Date(attendance.checkInTime).getTime() +
        settings.minimumWorkingHours * 60 * 60 * 1000
    );
    const diff = allowedCheckoutTime - now;
    remainingMinutes = diff > 0 ? Math.ceil(diff / (1000 * 60)) : 0;
  }

  return {
    attendance,
    settings: {
      minimumWorkingHours: settings.minimumWorkingHours,
      fullDayHours: settings.fullDayHours,
    },
    allowedCheckoutTime: allowedCheckoutTime?.toISOString() ?? null,
    remainingMinutes,
    canCheckOut: allowedCheckoutTime ? now >= allowedCheckoutTime : true,
  };
};

// ─────────────────────────────────────────────
// GET MY ATTENDANCE HISTORY (for logged-in user)
// ─────────────────────────────────────────────

const getMyAttendance = async (requestingUser, query) => {
  const { month, year, startDate, endDate, page, limit } = query;
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const where = { userId: requestingUser.id };

  if (month && year) {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    where.date = { gte: from, lte: to };
  } else if (startDate && endDate) {
    where.date = { gte: new Date(startDate), lte: new Date(endDate) };
  }

  const [records, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      orderBy: { date: 'desc' },
      skip,
      take,
    }),
    prisma.attendance.count({ where }),
  ]);

  return { records, pagination: buildPaginationMeta(total, pageNum, limitNum) };
};

// ─────────────────────────────────────────────
// ADMIN — GET ALL ATTENDANCE (filterable)
// ─────────────────────────────────────────────

const getAllAttendance = async (query) => {
  const { userId, month, year, startDate, endDate, status, page, limit } = query;
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const where = {};

  if (userId) where.userId = userId;
  if (status) where.status = status;

  if (month && year) {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    where.date = { gte: from, lte: to };
  } else if (startDate && endDate) {
    where.date = { gte: new Date(startDate), lte: new Date(endDate) };
  }

  const [records, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      orderBy: { date: 'desc' },
      skip,
      take,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
    prisma.attendance.count({ where }),
  ]);

  return { records, pagination: buildPaginationMeta(total, pageNum, limitNum) };
};

// ─────────────────────────────────────────────
// ADMIN — GET USER ATTENDANCE (calendar view)
// ─────────────────────────────────────────────

const getUserAttendance = async (userId, query) => {
  // Verify user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) throw new AppError('User not found', 404);

  const { month, year } = query;

  // Default: current month
  const y = year ?? new Date().getUTCFullYear();
  const m = month ?? new Date().getUTCMonth() + 1;

  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

  const records = await prisma.attendance.findMany({
    where: { userId, date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
  });

  // Build a map keyed by date string for easy calendar rendering
  const calendarMap = {};
  for (const r of records) {
    const key = r.date.toISOString().slice(0, 10);
    calendarMap[key] = r;
  }

  // Summary counts
  const summary = {
    present: records.filter((r) => r.status === 'PRESENT').length,
    halfDay: records.filter((r) => r.status === 'HALF_DAY').length,
    absent: records.filter((r) => r.status === 'ABSENT').length,
    totalWorkingDays: records.length,
    totalHours: Math.round(
      records.reduce((sum, r) => sum + (r.totalHours ?? 0), 0) * 100
    ) / 100,
  };

  return { user, records, calendarMap, summary, month: m, year: y };
};

// ─────────────────────────────────────────────
// ADMIN — MANUAL ATTENDANCE OVERRIDE
// ─────────────────────────────────────────────

const manualOverride = async (data, requestingUser) => {
  const settings = await getSettings();

  const date = startOfDay(new Date(data.date));

  // Calculate hours if both times provided
  let totalHours = null;
  let status = data.status ?? 'ABSENT';

  if (data.checkInTime && data.checkOutTime) {
    totalHours = calcHours(data.checkInTime, data.checkOutTime);
    status = data.status ?? deriveStatus(totalHours, settings.fullDayHours);
  } else if (data.checkInTime && !data.checkOutTime) {
    status = 'ABSENT'; // Checked in but never out → treat as absent unless explicitly set
    if (data.status) status = data.status;
  }

  const attendance = await prisma.attendance.upsert({
    where: { userId_date: { userId: data.userId, date } },
    create: {
      userId: data.userId,
      date,
      checkInTime: data.checkInTime ? new Date(data.checkInTime) : null,
      checkOutTime: data.checkOutTime ? new Date(data.checkOutTime) : null,
      totalHours,
      status,
      note: data.note ?? `Manually set by admin (${requestingUser.name})`,
      isManual: true,
    },
    update: {
      checkInTime: data.checkInTime ? new Date(data.checkInTime) : null,
      checkOutTime: data.checkOutTime ? new Date(data.checkOutTime) : null,
      totalHours,
      status,
      note: data.note ?? `Updated by admin (${requestingUser.name})`,
      isManual: true,
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  return attendance;
};

// ─────────────────────────────────────────────
// ADMIN — ATTENDANCE SETTINGS
// ─────────────────────────────────────────────

const getAttendanceSettings = async () => {
  return getSettings();
};

const updateAttendanceSettings = async (data, requestingUser) => {
  const settings = await getSettings();

  return prisma.attendanceSettings.update({
    where: { id: settings.id },
    data: {
      minimumWorkingHours: data.minimumWorkingHours ?? null,
      fullDayHours: data.fullDayHours ?? 8,
      updatedById: requestingUser.id,
    },
  });
};

// ─────────────────────────────────────────────
// AUTO-ABSENT JOB (call this via cron at end of day)
// ─────────────────────────────────────────────

/**
 * Mark all users who did NOT check in today as ABSENT.
 * Run this as a daily cron job at 11:59 PM or at start of next day.
 *
 * Usage: await attendanceService.markAbsentForToday()
 */
const markAbsentForToday = async () => {
  const today = startOfDay();

  // Get all active users
  const allUsers = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  // Get users who already have a record for today
  const existingRecords = await prisma.attendance.findMany({
    where: { date: today },
    select: { userId: true },
  });

  const existingUserIds = new Set(existingRecords.map((r) => r.userId));
  const absentUserIds = allUsers
    .map((u) => u.id)
    .filter((id) => !existingUserIds.has(id));

  if (absentUserIds.length === 0) return { marked: 0 };

  // Create ABSENT records for all missing users
  await prisma.attendance.createMany({
    data: absentUserIds.map((userId) => ({
      userId,
      date: today,
      status: 'ABSENT',
    })),
    skipDuplicates: true,
  });

  return { marked: absentUserIds.length };
};

// ─────────────────────────────────────────────
// ADMIN — ATTENDANCE STATS SUMMARY
// ─────────────────────────────────────────────

const getAttendanceStats = async (query) => {
  const { month, year } = query;

  const y = year ?? new Date().getUTCFullYear();
  const m = month ?? new Date().getUTCMonth() + 1;

  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

  const [present, halfDay, absent, totalUsers] = await Promise.all([
    prisma.attendance.count({ where: { date: { gte: from, lte: to }, status: 'PRESENT' } }),
    prisma.attendance.count({ where: { date: { gte: from, lte: to }, status: 'HALF_DAY' } }),
    prisma.attendance.count({ where: { date: { gte: from, lte: to }, status: 'ABSENT' } }),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
  ]);

  return { present, halfDay, absent, totalUsers, month: m, year: y };
};

export default {
  checkIn,
  checkOut,
  getTodayAttendance,
  getMyAttendance,
  getAllAttendance,
  getUserAttendance,
  manualOverride,
  getAttendanceSettings,
  updateAttendanceSettings,
  markAbsentForToday,
  getAttendanceStats,
};