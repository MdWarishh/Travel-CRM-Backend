import prisma from '../../config/db.js';
import { AppError } from '../../utils/helpers.js';
import { emitToAll, emitToRole, emitToUser } from '../../sockets/index.js';
import { createFromTicketPayment } from '../payments/unified_payment.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const toMinutes = (timeStr) => {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

const hasTimeOverlap = (seller, buyer) => {
  const sellerDepart = toMinutes(seller.departureTime);
  const sellerArrive = toMinutes(seller.arrivalTime);
  const buyerFrom    = toMinutes(buyer.preferredTimeFrom);
  const buyerTo      = toMinutes(buyer.preferredTimeTo);
  return sellerDepart <= buyerTo && sellerArrive >= buyerFrom;
};

const normalizeCity = (city) => city.trim().toLowerCase();

const isSameDate = (d1, d2) => {
  const a = new Date(d1);
  const b = new Date(d2);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
  );
};

/**
 * Calculate P&L for a deal
 */
const calcPnl = (seatsBooked, sellerCostPerSeat, buyerPricePerSeat) => {
  if (!seatsBooked) return {};
  const totalRevenue = (buyerPricePerSeat || 0) * seatsBooked;
  const totalCost    = (sellerCostPerSeat || 0) * seatsBooked;
  const grossProfit  = totalRevenue - totalCost;
  return { totalRevenue, totalCost, grossProfit };
};

// ── Shared includes ───────────────────────────────────────────────────────────
const sellerInclude = {
  createdBy: { select: { id: true, name: true, role: true } },
};

const buyerInclude = {
  createdBy: { select: { id: true, name: true, role: true } },
};

const dealInclude = {
  seller:    { include: sellerInclude },
  buyer:     { include: buyerInclude },
  managedBy: { select: { id: true, name: true, role: true } },
  payments:  true,
};

// ─────────────────────────────────────────────────────────────────────────────
// AGENT PERMISSIONS
// ─────────────────────────────────────────────────────────────────────────────

export const getAgentPermissions = async (userId) => {
  const perm = await prisma.agentPermission.findUnique({ where: { userId } });
  if (!perm) throw new AppError('No permissions found for this agent', 404);
  return perm;
};

export const upsertAgentPermissions = async (data) => {
  return prisma.agentPermission.upsert({
    where:  { userId: data.userId },
    update: data,
    create: data,
  });
};

export const getAllAgentPermissions = async () => {
  return prisma.agentPermission.findMany({
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
};

/**
 * Middleware helper — check if agent has a specific ticket permission.
 * ADMIN and MANAGER bypass all permission checks.
 */
export const checkTicketPermission = async (userId, userRole, permission) => {
  if (userRole === 'ADMIN' || userRole === 'MANAGER') return true;

  const perm = await prisma.agentPermission.findUnique({ where: { userId } });
  if (!perm) throw new AppError('Access denied — no permissions configured', 403);
  if (!perm[permission]) throw new AppError(`Access denied — missing permission: ${permission}`, 403);
  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// MATCHING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export const findMatches = async () => {
  const [sellers, buyers, existingDeals] = await Promise.all([
    prisma.ticketSeller.findMany({ where: { isActive: true }, include: sellerInclude }),
    prisma.ticketBuyer.findMany({ where: { isActive: true }, include: buyerInclude }),
    prisma.ticketDeal.findMany({
      where:  { status: { in: ['PENDING', 'CONNECTED', 'COMPLETED'] } },
      select: { sellerId: true, buyerId: true },
    }),
  ]);

  const dealtPairs = new Set(existingDeals.map((d) => `${d.sellerId}::${d.buyerId}`));
  const matches = [];

  for (const seller of sellers) {
    for (const buyer of buyers) {
      if (dealtPairs.has(`${seller.id}::${buyer.id}`)) continue;
      if (normalizeCity(seller.fromCity) !== normalizeCity(buyer.fromCity)) continue;
      if (normalizeCity(seller.toCity) !== normalizeCity(buyer.toCity)) continue;
      if (!isSameDate(seller.travelDate, buyer.travelDate)) continue;
      if (!hasTimeOverlap(seller, buyer)) continue;
      if (seller.seatsAvailable < buyer.seatsRequired) continue;

      // Margin calculation for match suggestions
      const margin = seller.pricePerSeat - buyer.budgetPerSeat;
      matches.push({ seller, buyer, margin, feasible: margin <= 0 });
    }
  }

  return matches.sort((a, b) => a.margin - b.margin); // best matches first
};

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD STATS (enhanced)
// ─────────────────────────────────────────────────────────────────────────────

export const getDashboardStats = async () => {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [
    totalSellers,
    totalBuyers,
    dealsCompleted,
    dealsPending,
    dealsConnected,
    dealsRejected,
    todayDeals,
    monthDeals,
    completedDeals,
    matches,
    payments,
  ] = await Promise.all([
    prisma.ticketSeller.count({ where: { isActive: true } }),
    prisma.ticketBuyer.count({ where: { isActive: true } }),
    prisma.ticketDeal.count({ where: { status: 'COMPLETED' } }),
    prisma.ticketDeal.count({ where: { status: 'PENDING' } }),
    prisma.ticketDeal.count({ where: { status: 'CONNECTED' } }),
    prisma.ticketDeal.count({ where: { status: 'REJECTED' } }),
    prisma.ticketDeal.count({ where: { createdAt: { gte: todayStart, lte: todayEnd } } }),
    prisma.ticketDeal.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.ticketDeal.findMany({
      where:  { status: 'COMPLETED' },
      select: { totalRevenue: true, totalCost: true, grossProfit: true, commission: true },
    }),
    findMatches(),
    prisma.ticketPayment.groupBy({
      by: ['type'],
      _sum: { amount: true },
    }),
  ]);

  // Revenue calculations
  const totalRevenue  = completedDeals.reduce((s, d) => s + (d.totalRevenue || 0), 0);
  const totalCost     = completedDeals.reduce((s, d) => s + (d.totalCost || 0), 0);
  const totalProfit   = completedDeals.reduce((s, d) => s + (d.grossProfit || 0), 0);
  const totalCommission = completedDeals.reduce((s, d) => s + (d.commission || 0), 0);

  const received = payments.find((p) => p.type === 'RECEIVED')?._sum?.amount || 0;
  const paid     = payments.find((p) => p.type === 'PAID')?._sum?.amount || 0;

  return {
    overview: {
      totalSellers,
      totalBuyers,
      matchesFound:    matches.length,
      feasibleMatches: matches.filter((m) => m.feasible).length,
    },
    deals: {
      total:     dealsCompleted + dealsPending + dealsConnected + dealsRejected,
      completed: dealsCompleted,
      pending:   dealsPending,
      connected: dealsConnected,
      rejected:  dealsRejected,
      today:     todayDeals,
      thisMonth: monthDeals,
    },
    financials: {
      totalRevenue,
      totalCost,
      totalProfit,
      totalCommission,
      cashReceived: received,
      cashPaid:     paid,
      netCash:      received - paid,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// TICKET SELLERS — CRUD (enhanced)
// ─────────────────────────────────────────────────────────────────────────────

export const getAllSellers = async (filters = {}) => {
  const where = { isActive: true };
  if (filters.fromCity) where.fromCity = { contains: filters.fromCity, mode: 'insensitive' };
  if (filters.toCity)   where.toCity   = { contains: filters.toCity, mode: 'insensitive' };
  if (filters.airline)  where.airline  = { contains: filters.airline, mode: 'insensitive' };
  if (filters.dateFrom) where.travelDate = { gte: new Date(filters.dateFrom) };
  if (filters.dateTo)   where.travelDate = { ...where.travelDate, lte: new Date(filters.dateTo) };

  return prisma.ticketSeller.findMany({
    where,
    include: { ...sellerInclude, deals: { select: { id: true, status: true } } },
    orderBy: { createdAt: 'desc' },
  });
};

export const getSellerById = async (id) => {
  const seller = await prisma.ticketSeller.findUnique({
    where:   { id },
    include: { ...sellerInclude, deals: { include: dealInclude } },
  });
  if (!seller) throw new AppError('Seller listing not found', 404);
  return seller;
};

export const createSeller = async (data, requestingUser) => {
  const totalValue = data.seatsAvailable * data.pricePerSeat;

  const seller = await prisma.ticketSeller.create({
    data: {
      brokerName:     data.brokerName,
      phone:          data.phone,
      email:          data.email,
      fromCity:       data.fromCity,
      toCity:         data.toCity,
      departureTime:  data.departureTime,
      arrivalTime:    data.arrivalTime,
      travelDate:     new Date(data.travelDate),
      seatsAvailable: data.seatsAvailable,
      pricePerSeat:   data.pricePerSeat,
      totalValue,
      // New fields
      airline:        data.airline,
      flightNumber:   data.flightNumber,
      bookingRef:     data.bookingRef,
      ticketClass:    data.ticketClass,
      pnr:            data.pnr,
      purchasePrice:  data.purchasePrice,
      purchasedFrom:  data.purchasedFrom,
      purchasedAt:    data.purchasedAt ? new Date(data.purchasedAt) : undefined,
      sourceChannel:  data.sourceChannel,
      emailSource:    data.emailSource,
      notes:          data.notes,
      createdById:    requestingUser.id,
    },
    include: sellerInclude,
  });

  const [matches, stats] = await Promise.all([findMatches(), getDashboardStats()]);
  emitToAll('seller_added',    { seller });
  emitToAll('matches_updated', { matches });
  emitToAll('stats_updated',   stats);

  return { seller, matches };
};

export const updateSeller = async (id, data, requestingUser) => {
  const existing = await getSellerById(id);

  if (
    requestingUser.role !== 'ADMIN' &&
    requestingUser.role !== 'MANAGER' &&
    existing.createdById !== requestingUser.id
  ) throw new AppError('You can only edit your own listings', 403);

  // Recalculate totalValue if seats or price changed
  const seatsAvailable = data.seatsAvailable ?? existing.seatsAvailable;
  const pricePerSeat   = data.pricePerSeat   ?? existing.pricePerSeat;
  const totalValue     = seatsAvailable * pricePerSeat;

  const updated = await prisma.ticketSeller.update({
    where: { id },
    data:  {
      ...Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined)
      ),
      totalValue,
      ...(data.travelDate   && { travelDate:   new Date(data.travelDate) }),
      ...(data.purchasedAt  && { purchasedAt:  new Date(data.purchasedAt) }),
    },
    include: sellerInclude,
  });

  const [matches, stats] = await Promise.all([findMatches(), getDashboardStats()]);
  emitToAll('seller_updated',  { seller: updated });
  emitToAll('matches_updated', { matches });
  emitToAll('stats_updated',   stats);

  return updated;
};

export const deleteSeller = async (id) => {
  await getSellerById(id);
  await prisma.ticketSeller.delete({ where: { id } });

  const [matches, stats] = await Promise.all([findMatches(), getDashboardStats()]);
  emitToAll('seller_deleted',  { sellerId: id });
  emitToAll('matches_updated', { matches });
  emitToAll('stats_updated',   stats);

  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// TICKET BUYERS — CRUD (enhanced)
// ─────────────────────────────────────────────────────────────────────────────

export const getAllBuyers = async (filters = {}) => {
  const where = { isActive: true };
  if (filters.fromCity) where.fromCity = { contains: filters.fromCity, mode: 'insensitive' };
  if (filters.toCity)   where.toCity   = { contains: filters.toCity, mode: 'insensitive' };
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.dateFrom) where.travelDate = { gte: new Date(filters.dateFrom) };
  if (filters.dateTo)   where.travelDate = { ...where.travelDate, lte: new Date(filters.dateTo) };

  return prisma.ticketBuyer.findMany({
    where,
    include: { ...buyerInclude, deals: { select: { id: true, status: true } } },
    orderBy: { createdAt: 'desc' },
  });
};

export const getBuyerById = async (id) => {
  const buyer = await prisma.ticketBuyer.findUnique({
    where:   { id },
    include: { ...buyerInclude, deals: { include: dealInclude } },
  });
  if (!buyer) throw new AppError('Buyer request not found', 404);
  return buyer;
};

export const createBuyer = async (data, requestingUser) => {
  const buyer = await prisma.ticketBuyer.create({
    data: {
      brokerName:         data.brokerName,
      phone:              data.phone,
      email:              data.email,
      fromCity:           data.fromCity,
      toCity:             data.toCity,
      preferredTimeFrom:  data.preferredTimeFrom,
      preferredTimeTo:    data.preferredTimeTo,
      travelDate:         new Date(data.travelDate),
      seatsRequired:      data.seatsRequired,
      budgetPerSeat:      data.budgetPerSeat,
      // New fields
      passengerCount:     data.passengerCount,
      passengerNames:     data.passengerNames,
      agreedPricePerSeat: data.agreedPricePerSeat,
      totalCollected:     data.totalCollected,
      paymentMethod:      data.paymentMethod,
      paymentStatus:      data.paymentStatus,
      paymentDate:        data.paymentDate ? new Date(data.paymentDate) : undefined,
      paymentRef:         data.paymentRef,
      sourceChannel:      data.sourceChannel,
      emailSource:        data.emailSource,
      notes:              data.notes,
      createdById:        requestingUser.id,
    },
    include: buyerInclude,
  });

  const [matches, stats] = await Promise.all([findMatches(), getDashboardStats()]);
  emitToAll('buyer_added',     { buyer });
  emitToAll('matches_updated', { matches });
  emitToAll('stats_updated',   stats);

  return { buyer, matches };
};

export const updateBuyer = async (id, data, requestingUser) => {
  const existing = await getBuyerById(id);

  if (
    requestingUser.role !== 'ADMIN' &&
    requestingUser.role !== 'MANAGER' &&
    existing.createdById !== requestingUser.id
  ) throw new AppError('You can only edit your own requests', 403);

  const updated = await prisma.ticketBuyer.update({
    where: { id },
    data: {
      ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
      ...(data.travelDate  && { travelDate:  new Date(data.travelDate) }),
      ...(data.paymentDate && { paymentDate: new Date(data.paymentDate) }),
    },
    include: buyerInclude,
  });

  const [matches, stats] = await Promise.all([findMatches(), getDashboardStats()]);
  emitToAll('buyer_updated',   { buyer: updated });
  emitToAll('matches_updated', { matches });
  emitToAll('stats_updated',   stats);

  return updated;
};

export const deleteBuyer = async (id) => {
  await getBuyerById(id);
  await prisma.ticketBuyer.delete({ where: { id } });

  const [matches, stats] = await Promise.all([findMatches(), getDashboardStats()]);
  emitToAll('buyer_deleted',   { buyerId: id });
  emitToAll('matches_updated', { matches });
  emitToAll('stats_updated',   stats);

  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// TICKET DEALS — Admin managed (enhanced)
// ─────────────────────────────────────────────────────────────────────────────

export const getAllDeals = async (filters = {}) => {
  const where = {};
  if (filters.status) where.status = filters.status;
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.dateFrom) where.createdAt = { gte: new Date(filters.dateFrom) };
  if (filters.dateTo)   where.createdAt = { ...where.createdAt, lte: new Date(filters.dateTo) };

  return prisma.ticketDeal.findMany({
    where,
    include: dealInclude,
    orderBy: { createdAt: 'desc' },
  });
};

export const getDealById = async (id) => {
  const deal = await prisma.ticketDeal.findUnique({ where: { id }, include: dealInclude });
  if (!deal) throw new AppError('Deal not found', 404);
  return deal;
};

export const connectDeal = async (data, requestingUser) => {
  const [seller, buyer] = await Promise.all([
    getSellerById(data.sellerId),
    getBuyerById(data.buyerId),
  ]);

  const existing = await prisma.ticketDeal.findFirst({
    where: {
      sellerId: data.sellerId,
      buyerId:  data.buyerId,
      status:   { in: ['PENDING', 'CONNECTED'] },
    },
  });
  if (existing) throw new AppError('An active deal already exists for this pair', 409);

  // Auto-fill costs from seller/buyer if not provided
  const seatsBooked       = data.seatsBooked       ?? buyer.seatsRequired;
  const sellerCostPerSeat = data.sellerCostPerSeat ?? seller.pricePerSeat;
  const buyerPricePerSeat = data.buyerPricePerSeat ?? buyer.budgetPerSeat;
  const pnl               = calcPnl(seatsBooked, sellerCostPerSeat, buyerPricePerSeat);

  const deal = await prisma.ticketDeal.create({
    data: {
      sellerId:          data.sellerId,
      buyerId:           data.buyerId,
      status:            'CONNECTED',
      seatsBooked,
      sellerCostPerSeat,
      buyerPricePerSeat,
      commission:        data.commission,
      ...pnl,
      paymentStatus:     data.paymentStatus ?? 'PENDING',
      paymentRef:        data.paymentRef,
      adminNotes:        data.adminNotes,
      managedById:       requestingUser.id,
    },
    include: dealInclude,
  });

  const stats = await getDashboardStats();
  emitToAll('deal_created',  { deal });
  emitToAll('stats_updated', stats);

  return deal;
};

export const updateDeal = async (id, data, requestingUser) => {
  const existing = await getDealById(id);

  // Recalculate P&L if financial fields changed
  const seatsBooked       = data.seatsBooked       ?? existing.seatsBooked;
  const sellerCostPerSeat = data.sellerCostPerSeat ?? existing.sellerCostPerSeat;
  const buyerPricePerSeat = data.buyerPricePerSeat ?? existing.buyerPricePerSeat;
  const pnl = calcPnl(seatsBooked, sellerCostPerSeat, buyerPricePerSeat);

  const updated = await prisma.ticketDeal.update({
    where: { id },
    data: {
      ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
      ...pnl,
      managedById: requestingUser.id,
      ...(data.paymentReceivedAt && { paymentReceivedAt: new Date(data.paymentReceivedAt) }),
    },
    include: dealInclude,
  });

  const [matches, stats] = await Promise.all([findMatches(), getDashboardStats()]);
  emitToAll('deal_updated',    { deal: updated });
  emitToAll('matches_updated', { matches });
  emitToAll('stats_updated',   stats);

  return updated;
};

export const deleteDeal = async (id) => {
  await getDealById(id);
  await prisma.ticketDeal.delete({ where: { id } });

  const stats = await getDashboardStats();
  emitToAll('deal_deleted',  { dealId: id });
  emitToAll('stats_updated', stats);

  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT LEDGER (NEW)
// ─────────────────────────────────────────────────────────────────────────────

export const getDealPayments = async (dealId) => {
  await getDealById(dealId); // validate deal exists
  return prisma.ticketPayment.findMany({
    where:   { dealId },
    include: { recordedBy: { select: { id: true, name: true } } },
    orderBy: { paidAt: 'desc' },
  });
};

export const addPayment = async (dealId, data, requestingUser) => {
  const deal = await getDealById(dealId);

  const payment = await prisma.ticketPayment.create({
    data: {
      dealId,
      type:        data.type,
      amount:      data.amount,
      method:      data.method,
      reference:   data.reference,
      paidAt:      data.paidAt ? new Date(data.paidAt) : new Date(),
      notes:       data.notes,
      recordedById: requestingUser.id,
    },
    include: { recordedBy: { select: { id: true, name: true } } },
  });

  // Update deal paymentStatus based on total received vs totalRevenue
  if (data.type === 'RECEIVED') {
    const allReceived = await prisma.ticketPayment.aggregate({
      where: { dealId, type: 'RECEIVED' },
      _sum:  { amount: true },
    });
    const totalReceived = allReceived._sum.amount || 0;
    const paymentStatus = totalReceived >= (deal.totalRevenue || 0)
      ? 'RECEIVED' : 'PARTIAL';

    await prisma.ticketDeal.update({
      where: { id: dealId },
      data:  { paymentStatus, paymentReceivedAt: paymentStatus === 'RECEIVED' ? new Date() : undefined },
    });
  }

  // ── Sync to Unified Payment Ledger (non-blocking) ──────────────
  // RECEIVED = buyer ne paisa diya = INCOMING
  // PAID     = seller ko paisa diya = OUTGOING
  createFromTicketPayment({
    ticketPaymentId: payment.id,
    dealId,
    ticketType:  data.type,
    amount:      data.amount,
    method:      data.method  ?? null,
    reference:   data.reference ?? null,
    note:        data.notes   ?? null,
    paidAt:      data.paidAt  ?? null,
    createdById: requestingUser.id,
  }).catch(() => {});
  // ───────────────────────────────────────────────────────────────

  const stats = await getDashboardStats();
  emitToAll('payment_added',  { dealId, payment });
  emitToAll('stats_updated',  stats);

  return payment;
};

export const deletePayment = async (paymentId) => {
  await prisma.ticketPayment.delete({ where: { id: paymentId } });
  return true;
};

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS (NEW)
// ─────────────────────────────────────────────────────────────────────────────

export const getRevenueReport = async ({ dateFrom, dateTo, groupBy = 'month' } = {}) => {
  const where = { status: 'COMPLETED' };
  if (dateFrom) where.createdAt = { gte: new Date(dateFrom) };
  if (dateTo)   where.createdAt = { ...where.createdAt, lte: new Date(dateTo) };

  const deals = await prisma.ticketDeal.findMany({
    where,
    include: {
      seller: { select: { fromCity: true, toCity: true, airline: true } },
      buyer:  { select: { fromCity: true, toCity: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Group by month
  const grouped = {};
  for (const deal of deals) {
    const key = groupBy === 'month'
      ? `${deal.createdAt.getFullYear()}-${String(deal.createdAt.getMonth() + 1).padStart(2, '0')}`
      : deal.createdAt.toISOString().split('T')[0];

    if (!grouped[key]) grouped[key] = { revenue: 0, cost: 0, profit: 0, deals: 0, seats: 0 };
    grouped[key].revenue += deal.totalRevenue || 0;
    grouped[key].cost    += deal.totalCost    || 0;
    grouped[key].profit  += deal.grossProfit  || 0;
    grouped[key].deals   += 1;
    grouped[key].seats   += deal.seatsBooked  || 0;
  }

  // Route-wise breakdown
  const routeMap = {};
  for (const deal of deals) {
    const route = `${deal.seller.fromCity} → ${deal.seller.toCity}`;
    if (!routeMap[route]) routeMap[route] = { revenue: 0, profit: 0, deals: 0 };
    routeMap[route].revenue += deal.totalRevenue || 0;
    routeMap[route].profit  += deal.grossProfit  || 0;
    routeMap[route].deals   += 1;
  }

  return {
    timeline: Object.entries(grouped).map(([period, data]) => ({ period, ...data })),
    byRoute:  Object.entries(routeMap).map(([route, data]) => ({ route, ...data })),
    totals: {
      revenue: deals.reduce((s, d) => s + (d.totalRevenue || 0), 0),
      cost:    deals.reduce((s, d) => s + (d.totalCost    || 0), 0),
      profit:  deals.reduce((s, d) => s + (d.grossProfit  || 0), 0),
      deals:   deals.length,
      seats:   deals.reduce((s, d) => s + (d.seatsBooked  || 0), 0),
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// BULK IMPORT (NEW)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bulk import historical seller or buyer records.
 * Each record is attempted to be mapped to TicketSeller/TicketBuyer.
 * Failed mappings are stored as ImportedTicket with status PENDING for manual review.
 */
export const bulkImport = async (data, requestingUser) => {
  const { type, source, sourceEmail, importBatch, records } = data;
  const batchId = importBatch || `IMPORT-${Date.now()}`;
  const results = { success: 0, failed: 0, errors: [] };

  for (const record of records) {
    try {
      let referenceId = null;

      if (type === 'SELLER') {
        const created = await prisma.ticketSeller.create({
          data: {
            brokerName:     record.brokerName     || record.broker_name || 'Unknown',
            phone:          record.phone          || record.contact     || '0000000000',
            fromCity:       record.fromCity       || record.from        || record.origin,
            toCity:         record.toCity         || record.to          || record.destination,
            departureTime:  record.departureTime  || record.dep_time    || '00:00',
            arrivalTime:    record.arrivalTime    || record.arr_time    || '00:00',
            travelDate:     new Date(record.travelDate || record.date || Date.now()),
            seatsAvailable: Number(record.seatsAvailable || record.seats || 1),
            pricePerSeat:   Number(record.pricePerSeat  || record.price || 0),
            airline:        record.airline,
            flightNumber:   record.flightNumber || record.flight_no,
            bookingRef:     record.bookingRef   || record.booking_ref || record.pnr,
            pnr:            record.pnr,
            sourceChannel:  source === 'EMAIL' ? 'EMAIL' : 'MANUAL',
            emailSource:    sourceEmail,
            notes:          record.notes || `Imported from ${source}`,
            createdById:    requestingUser.id,
          },
        });
        referenceId = created.id;
      } else {
        const created = await prisma.ticketBuyer.create({
          data: {
            brokerName:        record.brokerName        || record.broker_name || 'Unknown',
            phone:             record.phone             || record.contact     || '0000000000',
            fromCity:          record.fromCity          || record.from        || record.origin,
            toCity:            record.toCity            || record.to          || record.destination,
            preferredTimeFrom: record.preferredTimeFrom || record.time_from   || '00:00',
            preferredTimeTo:   record.preferredTimeTo   || record.time_to     || '23:59',
            travelDate:        new Date(record.travelDate || record.date || Date.now()),
            seatsRequired:     Number(record.seatsRequired || record.seats   || 1),
            budgetPerSeat:     Number(record.budgetPerSeat  || record.budget || 0),
            sourceChannel:     source === 'EMAIL' ? 'EMAIL' : 'MANUAL',
            emailSource:       sourceEmail,
            notes:             record.notes || `Imported from ${source}`,
            createdById:       requestingUser.id,
          },
        });
        referenceId = created.id;
      }

      // Log successful import
      await prisma.importedTicket.create({
        data: {
          importedById: requestingUser.id,
          rawData:      record,
          mappedTo:     type,
          referenceId,
          source,
          sourceEmail,
          importBatch:  batchId,
          status:       'MAPPED',
        },
      });

      results.success++;
    } catch (err) {
      // Store failed record for manual review
      await prisma.importedTicket.create({
        data: {
          importedById: requestingUser.id,
          rawData:      record,
          mappedTo:     type,
          source,
          sourceEmail,
          importBatch:  batchId,
          status:       'PENDING',
          notes:        err.message,
        },
      });
      results.failed++;
      results.errors.push({ record, error: err.message });
    }
  }

  // Refresh stats after import
  const [matches, stats] = await Promise.all([findMatches(), getDashboardStats()]);
  emitToAll('bulk_import_complete', { batchId, results });
  emitToAll('matches_updated', { matches });
  emitToAll('stats_updated',   stats);

  return { batchId, ...results };
};

export const getImportHistory = async () => {
  return prisma.importedTicket.findMany({
    include: { importedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// WHATSAPP LINK (unchanged logic, enhanced message)
// ─────────────────────────────────────────────────────────────────────────────

export const generateWhatsAppLink = async (dealId, targetRole = 'seller') => {
  const deal = await getDealById(dealId);
  const { seller, buyer } = deal;

  const profitLine = deal.grossProfit
    ? `*Profit:* ₹${deal.grossProfit.toFixed(2)}`
    : '';

  const message = [
    `✈️ *Flight Ticket Deal — ${deal.status}*`,
    ``,
    `*Route:* ${seller.fromCity} → ${seller.toCity}`,
    `*Date:* ${new Date(seller.travelDate).toLocaleDateString('en-IN')}`,
    seller.airline ? `*Airline:* ${seller.airline} ${seller.flightNumber || ''}` : '',
    seller.pnr     ? `*PNR:* ${seller.pnr}` : '',
    ``,
    `*Seller Details:*`,
    `  Broker: ${seller.brokerName}`,
    `  Phone: ${seller.phone}`,
    `  Departure: ${seller.departureTime} | Arrival: ${seller.arrivalTime}`,
    `  Seats Available: ${seller.seatsAvailable} | Price/Seat: ₹${seller.pricePerSeat}`,
    ``,
    `*Buyer Details:*`,
    `  Broker: ${buyer.brokerName}`,
    `  Phone: ${buyer.phone}`,
    `  Preferred: ${buyer.preferredTimeFrom} – ${buyer.preferredTimeTo}`,
    `  Seats Required: ${buyer.seatsRequired} | Budget/Seat: ₹${buyer.budgetPerSeat}`,
    ``,
    deal.seatsBooked ? `*Deal Seats:* ${deal.seatsBooked}` : '',
    deal.buyerPricePerSeat ? `*Final Price/Seat:* ₹${deal.buyerPricePerSeat}` : '',
    deal.totalRevenue ? `*Total Value:* ₹${deal.totalRevenue}` : '',
    profitLine,
    ``,
    `*Payment Status:* ${deal.paymentStatus || 'PENDING'}`,
    `*Deal Status:* ${deal.status}`,
    deal.adminNotes ? `\n*Notes:* ${deal.adminNotes}` : '',
  ].filter(Boolean).join('\n');

  const targetPhone = targetRole === 'buyer'
    ? buyer.phone.replace(/[^0-9]/g, '')
    : seller.phone.replace(/[^0-9]/g, '');

  return {
    whatsappUrl: `https://wa.me/${targetPhone}?text=${encodeURIComponent(message)}`,
    message,
    targetPhone,
  };
};