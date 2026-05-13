import prisma from '../../config/db.js';
import { AppError, getPagination, buildPaginationMeta } from '../../utils/helpers.js';

// ─────────────────────────────────────────────
// INCLUDE — reused across queries
// ─────────────────────────────────────────────

const unifiedPaymentInclude = {
  customer:  { select: { id: true, name: true, phone: true, email: true } },
  vendor:    { select: { id: true, name: true, phone: true, serviceType: true } },
  booking:   { select: { id: true, status: true, travelStart: true, travelEnd: true } },
  invoice:   { select: { id: true, invoiceNumber: true, totalAmount: true, status: true } },
  deal:      { select: { id: true, status: true, totalRevenue: true, totalCost: true, grossProfit: true,
                seller: { select: { fromCity: true, toCity: true, airline: true, travelDate: true } },
                buyer:  { select: { brokerName: true, phone: true } },
              }},
  createdBy: { select: { id: true, name: true, role: true } },
};

// ─────────────────────────────────────────────
// INTERNAL — auto-create from other services
// Only call these from booking/invoice/ticket services
// ─────────────────────────────────────────────

/**
 * Called from booking.service.js → addPayment
 * Creates INCOMING entry for a booking payment
 */
export const createFromBookingPayment = async ({
  bookingPaymentId,
  bookingId,
  customerId,
  amount,
  method,
  reference,
  note,
  paidAt,
  createdById,
}) => {
  try {
    await prisma.unifiedPayment.create({
      data: {
        type:       'INCOMING',
        source:     'BOOKING',
        sourceId:   bookingPaymentId,
        customerId,
        bookingId,
        amount,
        method:     method ?? 'CASH',
        status:     'PAID',
        reference:  reference ?? null,
        note:       note ?? null,
        paidAt:     paidAt ? new Date(paidAt) : new Date(),
        createdById: createdById ?? null,
      },
    });
  } catch (_) {
    // Non-blocking — unified ledger failure should never break the booking flow
    console.error('[UnifiedPayment] Failed to create from booking payment:', _?.message);
  }
};

/**
 * Called from invoice.service.js → recordPayment
 * Creates INCOMING entry for an invoice payment
 */
export const createFromInvoicePayment = async ({
  invoicePaymentId,
  invoiceId,
  customerId,
  bookingId,
  amount,
  method,
  reference,
  note,
  paidAt,
  createdById,
}) => {
  try {
    await prisma.unifiedPayment.create({
      data: {
        type:       'INCOMING',
        source:     'INVOICE',
        sourceId:   invoicePaymentId,
        customerId: customerId ?? null,
        bookingId:  bookingId ?? null,
        invoiceId:  invoiceId,
        amount,
        method:     method ?? 'CASH',
        status:     'PAID',
        reference:  reference ?? null,
        note:       note ?? null,
        paidAt:     paidAt ? new Date(paidAt) : new Date(),
        createdById: createdById ?? null,
      },
    });
  } catch (_) {
    console.error('[UnifiedPayment] Failed to create from invoice payment:', _?.message);
  }
};

/**
 * Called from ticket.service.js → addPayment
 * type: 'RECEIVED' → INCOMING (from buyer)
 * type: 'PAID'     → OUTGOING (to seller)
 */
export const createFromTicketPayment = async ({
  ticketPaymentId,
  dealId,
  ticketType,   // 'RECEIVED' | 'PAID'
  amount,
  method,
  reference,
  note,
  paidAt,
  createdById,
}) => {
  try {
    await prisma.unifiedPayment.create({
      data: {
        type:       ticketType === 'RECEIVED' ? 'INCOMING' : 'OUTGOING',
        source:     'TICKET',
        sourceId:   ticketPaymentId,
        dealId:     dealId,
        amount,
        method:     mapTicketMethod(method),
        status:     'PAID',
        reference:  reference ?? null,
        note:       note ?? null,
        paidAt:     paidAt ? new Date(paidAt) : new Date(),
        createdById: createdById ?? null,
      },
    });
  } catch (_) {
    console.error('[UnifiedPayment] Failed to create from ticket payment:', _?.message);
  }
};

// TicketPayment uses string methods (CASH, UPI, BANK_TRANSFER, CARD)
// Map to PaymentMode enum values
const mapTicketMethod = (method) => {
  const map = {
    CASH:          'CASH',
    UPI:           'UPI',
    BANK_TRANSFER: 'BANK_TRANSFER',
    CARD:          'CARD',
  };
  return map[method] ?? 'CASH';
};

// ─────────────────────────────────────────────
// GET ALL — with filters + pagination
// ─────────────────────────────────────────────

export const getAllUnifiedPayments = async (
  { page, limit, type, source, status, customerId, vendorId,
    bookingId, dealId, method, startDate, endDate, search, sort },
  requestingUser
) => {
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const where = {
    ...(type       && { type }),
    ...(source     && { source }),
    ...(status     && { status }),
    ...(customerId && { customerId }),
    ...(vendorId   && { vendorId }),
    ...(bookingId  && { bookingId }),
    ...(dealId     && { dealId }),
    ...(method     && { method }),

    // AGENT scoping — only see payments linked to their customers
    ...(requestingUser?.role === 'AGENT' && {
      OR: [
        { customer: { assignedToId: requestingUser.id } },
        { createdById: requestingUser.id },
      ],
    }),

    ...(startDate || endDate
      ? {
          paidAt: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate   && { lte: new Date(endDate) }),
          },
        }
      : {}),

    ...(search && {
      OR: [
        { customer: { name:  { contains: search, mode: 'insensitive' } } },
        { customer: { phone: { contains: search, mode: 'insensitive' } } },
        { vendor:   { name:  { contains: search, mode: 'insensitive' } } },
        { reference: { contains: search, mode: 'insensitive' } },
        { note:      { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const orderBy =
    sort === 'highest' ? { amount: 'desc' }
    : sort === 'lowest'  ? { amount: 'asc' }
    : sort === 'oldest'  ? { paidAt: 'asc' }
    : { paidAt: 'desc' };

  const [payments, total] = await Promise.all([
    prisma.unifiedPayment.findMany({ where, include: unifiedPaymentInclude, skip, take, orderBy }),
    prisma.unifiedPayment.count({ where }),
  ]);

  // Summary aggregation
  const [inAgg, outAgg, pendingAgg] = await Promise.all([
    prisma.unifiedPayment.aggregate({
      where: { ...where, type: 'INCOMING', status: 'PAID' },
      _sum: { amount: true },
    }),
    prisma.unifiedPayment.aggregate({
      where: { ...where, type: 'OUTGOING', status: 'PAID' },
      _sum: { amount: true },
    }),
    prisma.unifiedPayment.aggregate({
      where: { ...where, status: 'PENDING' },
      _sum: { amount: true },
    }),
  ]);

  const totalIncoming = inAgg._sum.amount ?? 0;
  const totalOutgoing = outAgg._sum.amount ?? 0;
  const totalPending  = pendingAgg._sum.amount ?? 0;

  return {
    payments,
    pagination: buildPaginationMeta(total, pageNum, limitNum),
    summary: {
      totalIncoming,
      totalOutgoing,
      netProfit: totalIncoming - totalOutgoing,
      totalPending,
    },
  };
};

// ─────────────────────────────────────────────
// GET SINGLE
// ─────────────────────────────────────────────

export const getUnifiedPaymentById = async (id) => {
  const payment = await prisma.unifiedPayment.findUnique({
    where: { id },
    include: unifiedPaymentInclude,
  });
  if (!payment) throw new AppError('Payment not found', 404);
  return payment;
};

// ─────────────────────────────────────────────
// MANUAL CREATE
// ─────────────────────────────────────────────

export const createManualPayment = async (data, userId) => {
  // Validate linked entities if provided
  if (data.customerId) {
    const c = await prisma.customer.findUnique({ where: { id: data.customerId }, select: { id: true } });
    if (!c) throw new AppError('Customer not found', 404);
  }
  if (data.vendorId) {
    const v = await prisma.vendor.findUnique({ where: { id: data.vendorId }, select: { id: true } });
    if (!v) throw new AppError('Vendor not found', 404);
  }
  if (data.bookingId) {
    const b = await prisma.booking.findUnique({ where: { id: data.bookingId }, select: { id: true } });
    if (!b) throw new AppError('Booking not found', 404);
  }

  const payment = await prisma.unifiedPayment.create({
    data: {
      type:        data.type,
      source:      'MANUAL',
      customerId:  data.customerId  ?? null,
      vendorId:    data.vendorId    ?? null,
      bookingId:   data.bookingId   ?? null,
      invoiceId:   data.invoiceId   ?? null,
      dealId:      data.dealId      ?? null,
      amount:      data.amount,
      method:      data.method      ?? 'CASH',
      status:      data.status      ?? 'PAID',
      reference:   data.reference   ?? null,
      note:        data.note        ?? null,
      paidAt:      data.paidAt ? new Date(data.paidAt) : new Date(),
      createdById: userId,
    },
    include: unifiedPaymentInclude,
  });

  return payment;
};

// ─────────────────────────────────────────────
// UPDATE (manual only — auto entries are source-of-truth in their own tables)
// ─────────────────────────────────────────────

export const updateManualPayment = async (id, data, userId) => {
  const existing = await getUnifiedPaymentById(id);
  if (existing.source !== 'MANUAL') {
    throw new AppError('Only manually created payments can be edited here. Edit from the source (booking/invoice/ticket).', 400);
  }

  const payment = await prisma.unifiedPayment.update({
    where: { id },
    data: {
      ...(data.type      !== undefined && { type: data.type }),
      ...(data.amount    !== undefined && { amount: data.amount }),
      ...(data.method    !== undefined && { method: data.method }),
      ...(data.status    !== undefined && { status: data.status }),
      ...(data.reference !== undefined && { reference: data.reference }),
      ...(data.note      !== undefined && { note: data.note }),
      ...(data.paidAt    !== undefined && { paidAt: new Date(data.paidAt) }),
      ...(data.customerId !== undefined && { customerId: data.customerId }),
      ...(data.vendorId   !== undefined && { vendorId: data.vendorId }),
    },
    include: unifiedPaymentInclude,
  });

  return payment;
};

// ─────────────────────────────────────────────
// DELETE (ADMIN only, manual only)
// ─────────────────────────────────────────────

export const deleteUnifiedPayment = async (id) => {
  const existing = await getUnifiedPaymentById(id);
  if (existing.source !== 'MANUAL') {
    throw new AppError('Auto-synced payments cannot be deleted here. Delete from the source.', 400);
  }
  await prisma.unifiedPayment.delete({ where: { id } });
  return true;
};

// ─────────────────────────────────────────────
// CUSTOMER PAYMENT PROFILE
// ─────────────────────────────────────────────

export const getCustomerPaymentProfile = async (customerId) => {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, phone: true, email: true },
  });
  if (!customer) throw new AppError('Customer not found', 404);

  const [payments, agg] = await Promise.all([
    prisma.unifiedPayment.findMany({
      where:   { customerId },
      include: unifiedPaymentInclude,
      orderBy: { paidAt: 'desc' },
    }),
    prisma.unifiedPayment.aggregate({
      where: { customerId },
      _sum:  { amount: true },
    }),
  ]);

  const totalPaid    = payments.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0);
  const totalPending = payments.filter(p => p.status === 'PENDING').reduce((s, p) => s + p.amount, 0);

  return {
    customer,
    totalPaid,
    totalPending,
    totalPayments: payments.length,
    payments,
  };
};

// ─────────────────────────────────────────────
// VENDOR PAYMENT PROFILE
// ─────────────────────────────────────────────

export const getVendorPaymentProfile = async (vendorId) => {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, name: true, phone: true, serviceType: true },
  });
  if (!vendor) throw new AppError('Vendor not found', 404);

  const payments = await prisma.unifiedPayment.findMany({
    where:   { vendorId },
    include: unifiedPaymentInclude,
    orderBy: { paidAt: 'desc' },
  });

  const totalPaid    = payments.filter(p => p.status === 'PAID').reduce((s, p) => s + p.amount, 0);
  const totalPending = payments.filter(p => p.status === 'PENDING').reduce((s, p) => s + p.amount, 0);

  return {
    vendor,
    totalPaid,
    totalPending,
    totalPayments: payments.length,
    payments,
  };
};

// ─────────────────────────────────────────────
// GLOBAL SUMMARY (for dashboard cards)
// ─────────────────────────────────────────────

export const getPaymentSummary = async (requestingUser) => {
  const agentFilter = requestingUser?.role === 'AGENT'
    ? { OR: [{ customer: { assignedToId: requestingUser.id } }, { createdById: requestingUser.id }] }
    : {};

  const [inAgg, outAgg, pendingAgg, bySource] = await Promise.all([
    prisma.unifiedPayment.aggregate({
      where: { ...agentFilter, type: 'INCOMING', status: 'PAID' },
      _sum: { amount: true },
    }),
    prisma.unifiedPayment.aggregate({
      where: { ...agentFilter, type: 'OUTGOING', status: 'PAID' },
      _sum: { amount: true },
    }),
    prisma.unifiedPayment.aggregate({
      where: { ...agentFilter, status: 'PENDING' },
      _sum: { amount: true },
    }),
    prisma.unifiedPayment.groupBy({
      by:    ['source'],
      where: agentFilter,
      _sum:  { amount: true },
      _count: { id: true },
    }),
  ]);

  const totalIncoming = inAgg._sum.amount  ?? 0;
  const totalOutgoing = outAgg._sum.amount ?? 0;

  return {
    totalIncoming,
    totalOutgoing,
    netProfit:    totalIncoming - totalOutgoing,
    totalPending: pendingAgg._sum.amount ?? 0,
    bySource: bySource.map(s => ({
      source: s.source,
      total:  s._sum.amount ?? 0,
      count:  s._count.id,
    })),
  };
};

// ─────────────────────────────────────────────
// EXPORT — CSV rows
// ─────────────────────────────────────────────

export const exportUnifiedPayments = async (filters, requestingUser) => {
  const { type, source, status, customerId, vendorId, startDate, endDate, method } = filters;

  const where = {
    ...(type       && { type }),
    ...(source     && { source }),
    ...(status     && { status }),
    ...(customerId && { customerId }),
    ...(vendorId   && { vendorId }),
    ...(method     && { method }),
    ...(requestingUser?.role === 'AGENT' && {
      OR: [
        { customer: { assignedToId: requestingUser.id } },
        { createdById: requestingUser.id },
      ],
    }),
    ...(startDate || endDate
      ? {
          paidAt: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate   && { lte: new Date(endDate) }),
          },
        }
      : {}),
  };

  const payments = await prisma.unifiedPayment.findMany({
    where,
    include: unifiedPaymentInclude,
    orderBy: { paidAt: 'desc' },
  });

  return payments.map((p) => ({
    'Payment ID':    p.id,
    'Type':          p.type,
    'Source':        p.source,
    'Customer':      p.customer?.name ?? '—',
    'Customer Phone':p.customer?.phone ?? '—',
    'Vendor':        p.vendor?.name ?? '—',
    'Amount':        p.amount,
    'Method':        p.method,
    'Status':        p.status,
    'Reference':     p.reference ?? '—',
    'Note':          p.note ?? '—',
    'Booking ID':    p.bookingId ?? '—',
    'Invoice No':    p.invoice?.invoiceNumber ?? '—',
    'Deal ID':       p.dealId ?? '—',
    'Paid At':       new Date(p.paidAt).toLocaleDateString('en-IN'),
    'Created At':    new Date(p.createdAt).toLocaleDateString('en-IN'),
    'Created By':    p.createdBy?.name ?? '—',
  }));
};