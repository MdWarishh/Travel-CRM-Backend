/**
 * vendor.service.js — Complete Fixed Version
 *
 * FIXES:
 *  1. getAllVendors — try/catch so status/types columns missing won't crash
 *  2. getVendorDashboardStats — fallback to isActive if status column missing
 *  3. getVendorById — id guard + VendorNote safe try/catch
 *  4. All mutating functions — isValidId guard on every function
 *  5. Normalize response — always returns types[], status, commissionPercentage
 *     even when DB has old schema
 */

import prisma from '../../config/db.js';
import { AppError, getPagination, buildPaginationMeta } from '../../utils/helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const isValidId = (id) =>
  typeof id === 'string' &&
  id.trim().length > 0 &&
  id !== 'undefined' &&
  id !== 'null';

const buildOrderBy = (sortBy) => {
  switch (sortBy) {
    case 'name':      return [{ name: 'asc' }];
    case 'city':      return [{ city: 'asc' }];
    case 'createdAt': return [{ createdAt: 'desc' }];
    default:          return [{ isPreferred: 'desc' }, { name: 'asc' }];
  }
};

/** Normalize a raw vendor row — fills defaults for new columns not in DB yet */
const normalizeVendor = (v) => ({
  ...v,
  types:               Array.isArray(v.types) && v.types.length ? v.types : (v.serviceType ? [v.serviceType] : ['OTHER']),
  status:              v.status ?? (v.isActive ? 'ACTIVE' : 'INACTIVE'),
  commissionPercentage: v.commissionPercentage ?? v.commissionRate ?? null,
});

/** Batch booking stats for a list of vendor ids */
const fetchVendorStats = async (vendorIds) => {
  if (!vendorIds.length) return new Map();
  const [grouped, lastDates] = await Promise.all([
    prisma.bookingItem.groupBy({
      by:    ['vendorId'],
      where: { vendorId: { in: vendorIds } },
      _count: { id: true },
      _sum:   { amount: true },
    }),
    prisma.bookingItem.findMany({
      where:    { vendorId: { in: vendorIds } },
      select:   { vendorId: true, createdAt: true },
      orderBy:  { createdAt: 'desc' },
      distinct: ['vendorId'],
    }),
  ]);

  const map = new Map();
  for (const g of grouped) {
    map.set(g.vendorId, { totalBookings: g._count.id, totalRevenue: g._sum.amount ?? 0, lastUsedDate: null });
  }
  for (const d of lastDates) {
    const existing = map.get(d.vendorId);
    if (existing) existing.lastUsedDate = d.createdAt;
    else map.set(d.vendorId, { totalBookings: 0, totalRevenue: 0, lastUsedDate: d.createdAt });
  }
  return map;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL VENDORS
// ─────────────────────────────────────────────────────────────────────────────

export const getAllVendors = async (query = {}) => {
  const { page, limit, search, type, city, status, isPreferred, sortBy } = query;
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);
  const dbOrder = (sortBy === 'usage' || sortBy === 'revenue') ? undefined : buildOrderBy(sortBy);

  // Attempt with new columns; fall back gracefully if migration hasn't run
  let vendors = [];
  let total   = 0;

  try {
    // ── New schema where ─────────────────────────────────────────────────────
    const where = {};
    if (status)     where.status = status;
    if (isPreferred === 'true' || isPreferred === true) where.isPreferred = true;
    if (city)       where.city   = { contains: city, mode: 'insensitive' };
    if (type)       where.OR     = [{ types: { has: type } }, { serviceType: type }];
    if (search) {
      const sOr = [
        { name:          { contains: search, mode: 'insensitive' } },
        { city:          { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
        { email:         { contains: search, mode: 'insensitive' } },
        { phone:         { contains: search, mode: 'insensitive' } },
      ];
      where.AND = where.OR ? [{ OR: where.OR }, { OR: sOr }] : undefined;
      if (!where.AND) where.OR = sOr;
      else delete where.OR;
    }

    const [rows, count] = await Promise.all([
      prisma.vendor.findMany({
        where, skip, take, orderBy: dbOrder,
        select: {
          id: true, name: true, types: true, serviceType: true,
          city: true, country: true, contactPerson: true,
          phone: true, email: true, status: true, isActive: true,
          isPreferred: true, commissionPercentage: true,
          commissionRate: true, createdAt: true, updatedAt: true,
        },
      }),
      prisma.vendor.count({ where }),
    ]);
    vendors = rows;
    total   = count;

  } catch {
    // ── Legacy schema fallback ───────────────────────────────────────────────
    const legacyWhere = {};
    if (status === 'ACTIVE')   legacyWhere.isActive = true;
    if (status === 'INACTIVE') legacyWhere.isActive = false;
    if (isPreferred === 'true' || isPreferred === true) legacyWhere.isPreferred = true;
    if (city)  legacyWhere.city        = { contains: city, mode: 'insensitive' };
    if (type)  legacyWhere.serviceType = type;
    if (search) {
      legacyWhere.OR = [
        { name:          { contains: search, mode: 'insensitive' } },
        { city:          { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
        { email:         { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rows, count] = await Promise.all([
      prisma.vendor.findMany({
        where: legacyWhere, skip, take, orderBy: dbOrder,
        select: {
          id: true, name: true, serviceType: true, city: true, country: true,
          contactPerson: true, phone: true, email: true, isActive: true,
          isPreferred: true, commissionRate: true, createdAt: true, updatedAt: true,
        },
      }),
      prisma.vendor.count({ where: legacyWhere }),
    ]);
    vendors = rows;
    total   = count;
  }

  // Normalize rows (fill new fields with defaults)
  let enriched = vendors.map((v) => ({
    ...normalizeVendor(v),
    ...(fetchVendorStats.placeholder ?? {}),
  }));

  // Attach booking stats
  const statsMap = await fetchVendorStats(enriched.map((v) => v.id));
  enriched = enriched.map((v) => ({
    ...v,
    ...(statsMap.get(v.id) ?? { totalBookings: 0, totalRevenue: 0, lastUsedDate: null }),
  }));

  if (sortBy === 'usage')   enriched.sort((a, b) => b.totalBookings - a.totalBookings);
  if (sortBy === 'revenue') enriched.sort((a, b) => b.totalRevenue  - a.totalRevenue);

  return { vendors: enriched, pagination: buildPaginationMeta(total, pageNum, limitNum) };
};

// ─────────────────────────────────────────────────────────────────────────────
// GET VENDOR BY ID — full profile
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorById = async (id) => {
  if (!isValidId(id)) throw new AppError('Invalid vendor id', 400);

  const [vendor, bookingItems] = await Promise.all([
    prisma.vendor.findUnique({ where: { id } }),
    prisma.bookingItem.findMany({
      where:   { vendorId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, type: true, amount: true, status: true,
        notes: true, referenceNumber: true, createdAt: true,
        booking: {
          select: {
            id: true, status: true, travelStart: true, travelEnd: true,
            totalAmount: true, paymentStatus: true,
            customer: { select: { id: true, name: true, phone: true } },
          },
        },
      },
    }),
  ]);

  if (!vendor) throw new AppError('Vendor not found', 404);

  // VendorNote — safe: return [] if table missing
  let notes = [];
  try {
    if (prisma.vendorNote) {
      notes = await prisma.vendorNote.findMany({
        where:   { vendorId: id },
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { id: true, name: true } } },
      });
    }
  } catch { notes = []; }

  // ── Stats ────────────────────────────────────────────────────────────────
  const totalBookings = bookingItems.length;
  const totalRevenue  = bookingItems.reduce((s, i) => s + (i.amount ?? 0), 0);
  const lastUsedDate  = bookingItems[0]?.createdAt ?? null;

  const activeStatuses = ['PENDING', 'REQUESTED', 'CONFIRMED', 'IN_PROGRESS', 'VOUCHER_SENT', 'READY'];
  const activeBookings = bookingItems.filter((i) => i.booking && activeStatuses.includes(i.booking.status));

  const pendingStatuses = ['PENDING', 'UNPAID', 'PARTIAL', 'PARTIALLY_PAID'];
  const pendingAmount   = bookingItems
    .filter((i) => i.booking && pendingStatuses.includes(i.booking.paymentStatus))
    .reduce((s, i) => s + (i.amount ?? 0), 0);

  const totalPaid      = totalRevenue - pendingAmount;
  const cancelledCount = bookingItems.filter((i) => i.booking?.status === 'CANCELLED').length;
  const cancellationRate = totalBookings > 0
    ? parseFloat(((cancelledCount / totalBookings) * 100).toFixed(1))
    : 0;
  const reliabilityScore = Math.round(
    Math.min(100, Math.max(0, 50 + Math.min(totalBookings * 2, 30) - cancellationRate * 0.5))
  );

  // Payment history
  const bookingIds = [...new Set(bookingItems.map((i) => i.booking?.id).filter(Boolean))];
  let paymentHistory = [];
  if (bookingIds.length) {
    paymentHistory = await prisma.bookingPayment.findMany({
      where:   { bookingId: { in: bookingIds } },
      orderBy: { paidAt: 'desc' },
      select:  { id: true, amount: true, mode: true, note: true, paidAt: true, bookingId: true },
    });
  }

  return {
    ...normalizeVendor(vendor),
    // Override 'notes' from vendor record with vendorNotes array
    // Use different key to avoid clash with vendor's internalNotes field
    vendorNotes: notes,   // used by NotesTab
    notes:       notes,   // also kept for backward compat

    summary: {
      totalBookings,
      totalRevenue,
      lastUsedDate,
      activeBookingsCount:   activeBookings.length,
      pendingPaymentsAmount: pendingAmount,
      totalPaid,
    },

    bookings: bookingItems.map((item) => ({
      bookingItemId:   item.id,
      bookingId:       item.booking?.id,
      customerName:    item.booking?.customer?.name ?? '—',
      customerId:      item.booking?.customer?.id,
      customerPhone:   item.booking?.customer?.phone,
      date:            item.booking?.travelStart ?? item.createdAt,
      amount:          item.amount,
      status:          item.booking?.status ?? item.status,
      paymentStatus:   item.booking?.paymentStatus,
      type:            item.type,
      referenceNumber: item.referenceNumber,
    })),

    payments: { totalPaid, pendingAmount, history: paymentHistory },

    performance: {
      totalBookings,
      lastUsedDate,
      cancellationRate,
      reliabilityScore,
      cancelledCount,
      activeCount: activeBookings.length,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────

export const createVendor = async (data) => {
  const serviceType = data.types?.[0] ?? data.serviceType ?? 'OTHER';

  // Try with new columns; fall back if missing
  try {
    return await prisma.vendor.create({
      data: {
        ...data,
        serviceType,
        isActive: data.status !== 'INACTIVE' && data.status !== 'BLACKLISTED',
      },
    });
  } catch {
    // Remove new columns and retry
    const { types, status, commissionPercentage, gstin, pan,
            bankName, accountName, accountNumber, ifscCode, upiId, isPreferred, ...rest } = data;
    return prisma.vendor.create({
      data: {
        ...rest,
        serviceType,
        isActive: true,
        ...(isPreferred !== undefined && { isPreferred }),
      },
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────────────────────

export const updateVendor = async (id, data) => {
  if (!isValidId(id)) throw new AppError('Invalid vendor id', 400);
  const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
  if (!vendor) throw new AppError('Vendor not found', 404);

  const updateData = { ...data };
  if (data.types?.length) updateData.serviceType = data.types[0];
  if (data.status)        updateData.isActive     = data.status === 'ACTIVE';

  try {
    return await prisma.vendor.update({ where: { id }, data: updateData });
  } catch {
    // New columns might not exist — strip them out and retry
    const { types, status, commissionPercentage, gstin, pan,
            bankName, accountName, accountNumber, ifscCode, upiId, ...safeData } = updateData;
    return prisma.vendor.update({ where: { id }, data: safeData });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE STATUS
// ─────────────────────────────────────────────────────────────────────────────

export const changeVendorStatus = async (id, status) => {
  if (!isValidId(id)) throw new AppError('Invalid vendor id', 400);
  const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
  if (!vendor) throw new AppError('Vendor not found', 404);

  try {
    return await prisma.vendor.update({ where: { id }, data: { status, isActive: status === 'ACTIVE' } });
  } catch {
    return prisma.vendor.update({ where: { id }, data: { isActive: status === 'ACTIVE' } });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE PREFERRED
// ─────────────────────────────────────────────────────────────────────────────

export const togglePreferred = async (id) => {
  if (!isValidId(id)) throw new AppError('Invalid vendor id', 400);
  const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true, isPreferred: true } });
  if (!vendor) throw new AppError('Vendor not found', 404);
  return prisma.vendor.update({ where: { id }, data: { isPreferred: !vendor.isPreferred } });
};

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE STATUS (legacy)
// ─────────────────────────────────────────────────────────────────────────────

export const toggleVendorStatus = async (id) => {
  if (!isValidId(id)) throw new AppError('Invalid vendor id', 400);
  const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true, isActive: true } });
  if (!vendor) throw new AppError('Vendor not found', 404);
  const newIsActive = !vendor.isActive;
  try {
    return await prisma.vendor.update({
      where: { id },
      data:  { isActive: newIsActive, status: newIsActive ? 'ACTIVE' : 'INACTIVE' },
    });
  } catch {
    return prisma.vendor.update({ where: { id }, data: { isActive: newIsActive } });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────────────────

export const deleteVendor = async (id) => {
  if (!isValidId(id)) throw new AppError('Invalid vendor id', 400);
  const vendor = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
  if (!vendor) throw new AppError('Vendor not found', 404);
  await prisma.vendor.delete({ where: { id } });
  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-SUGGEST
// ─────────────────────────────────────────────────────────────────────────────

export const suggestVendors = async ({ city, type, limit = 10 } = {}) => {
  const where = {};
  try { where.status = 'ACTIVE'; } catch { where.isActive = true; }
  if (city) where.city = { contains: city, mode: 'insensitive' };
  if (type) where.OR   = [{ types: { has: type } }, { serviceType: type }];

  try {
    return await prisma.vendor.findMany({
      where,
      orderBy: [{ isPreferred: 'desc' }, { name: 'asc' }],
      take: Math.min(Number(limit) || 10, 50),
      select: {
        id: true, name: true, types: true, serviceType: true,
        city: true, contactPerson: true, phone: true,
        commissionPercentage: true, isPreferred: true,
      },
    });
  } catch {
    const legacyWhere = { isActive: true };
    if (city) legacyWhere.city        = { contains: city, mode: 'insensitive' };
    if (type) legacyWhere.serviceType = type;
    const rows = await prisma.vendor.findMany({
      where: legacyWhere,
      orderBy: [{ isPreferred: 'desc' }, { name: 'asc' }],
      take: Math.min(Number(limit) || 10, 50),
      select: { id: true, name: true, serviceType: true, city: true, contactPerson: true, phone: true, commissionRate: true, isPreferred: true },
    });
    return rows.map((r) => ({ ...r, types: [r.serviceType ?? 'OTHER'], commissionPercentage: r.commissionRate }));
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// NOTES CRUD
// ─────────────────────────────────────────────────────────────────────────────

export const addVendorNote = async (vendorId, content, userId) => {
  if (!isValidId(vendorId)) throw new AppError('Invalid vendor id', 400);
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
  if (!vendor) throw new AppError('Vendor not found', 404);
  return prisma.vendorNote.create({
    data:    { vendorId, content, createdById: userId },
    include: { createdBy: { select: { id: true, name: true } } },
  });
};

export const updateVendorNote = async (noteId, content) => {
  if (!isValidId(noteId)) throw new AppError('Invalid note id', 400);
  const note = await prisma.vendorNote.findUnique({ where: { id: noteId }, select: { id: true } });
  if (!note) throw new AppError('Note not found', 404);
  return prisma.vendorNote.update({
    where:   { id: noteId },
    data:    { content },
    include: { createdBy: { select: { id: true, name: true } } },
  });
};

export const deleteVendorNote = async (noteId) => {
  if (!isValidId(noteId)) throw new AppError('Invalid note id', 400);
  const note = await prisma.vendorNote.findUnique({ where: { id: noteId }, select: { id: true } });
  if (!note) throw new AppError('Note not found', 404);
  await prisma.vendorNote.delete({ where: { id: noteId } });
  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD STATS
// ─────────────────────────────────────────────────────────────────────────────

export const getVendorDashboardStats = async () => {
  try {
    // New schema — status column exists
    const [total, preferred, blacklisted, active] = await Promise.all([
      prisma.vendor.count(),
      prisma.vendor.count({ where: { isPreferred: true } }),
      prisma.vendor.count({ where: { status: 'BLACKLISTED' } }),
      prisma.vendor.count({ where: { status: 'ACTIVE' } }),
    ]);
    return { total, preferred, blacklisted, active };
  } catch {
    // Legacy schema — use isActive
    const [total, preferred, active] = await Promise.all([
      prisma.vendor.count(),
      prisma.vendor.count({ where: { isPreferred: true } }),
      prisma.vendor.count({ where: { isActive: true } }),
    ]);
    return { total, preferred, blacklisted: 0, active };
  }
};