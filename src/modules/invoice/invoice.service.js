import prisma from '../../config/db.js';
import { AppError, getPagination, buildPaginationMeta } from '../../utils/helpers.js';
import { createFromInvoicePayment } from '../payments/unified_payment.service.js';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Generate next invoice number based on company settings.
 * Runs inside a transaction to avoid race conditions.
 */
const generateInvoiceNumber = async (tx) => {
  const settings = await tx.companySettings.findFirst();
  if (!settings) throw new AppError('Company settings not configured', 400);

  const format = settings.invoiceNumberFormat;
  const prefix = settings.invoicePrefix || 'INV';
  const currentYear = new Date().getFullYear();

  let nextNumber = settings.lastInvoiceNumber + 1;

  // YEARLY format: reset if new year
  if (format === 'YEARLY' && settings.lastResetYear !== currentYear) {
    nextNumber = 1;
    await tx.companySettings.updateMany({
      data: { lastResetYear: currentYear, lastInvoiceNumber: 1 },
    });
  } else {
    await tx.companySettings.updateMany({
      data: { lastInvoiceNumber: nextNumber },
    });
  }

  const padded = String(nextNumber).padStart(3, '0');

  if (format === 'YEARLY') {
    return `${prefix}-${currentYear}-${padded}`;
  }
  return `${prefix}-${padded}`;
};

/**
 * Calculate all GST amounts from items + gst config.
 */
const calculateInvoiceTotals = ({ items, discountType, discountValue, gstRate, gstType }) => {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);

  let discountAmount = 0;
  if (discountType === 'PERCENT' && discountValue > 0) {
    discountAmount = (subtotal * discountValue) / 100;
  } else if (discountType === 'FLAT' && discountValue > 0) {
    discountAmount = discountValue;
  }
  const taxableAmount = subtotal - discountAmount;

  let cgstRate = 0, sgstRate = 0, igstRate = 0;
  let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;

  if (gstType === 'CGST_SGST') {
    cgstRate = gstRate / 2;
    sgstRate = gstRate / 2;
    cgstAmount = parseFloat(((taxableAmount * cgstRate) / 100).toFixed(2));
    sgstAmount = parseFloat(((taxableAmount * sgstRate) / 100).toFixed(2));
  } else if (gstType === 'IGST') {
    igstRate = gstRate;
    igstAmount = parseFloat(((taxableAmount * igstRate) / 100).toFixed(2));
  }

  const totalGst = cgstAmount + sgstAmount + igstAmount;
  const totalAmount = parseFloat((taxableAmount + totalGst).toFixed(2));

  return {
    subtotal: parseFloat(subtotal.toFixed(2)),
    discountAmount: parseFloat(discountAmount.toFixed(2)),
    taxableAmount: parseFloat(taxableAmount.toFixed(2)),
    cgstRate,
    sgstRate,
    igstRate,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalGst: parseFloat(totalGst.toFixed(2)),
    totalAmount,
  };
};

/**
 * Determine invoice status based on payments.
 */
const resolveStatus = (totalAmount, paidAmount, currentStatus) => {
  if (currentStatus === 'CANCELLED') return 'CANCELLED';
  if (paidAmount >= totalAmount) return 'PAID';
  if (paidAmount > 0) return 'PARTIAL';
  return 'UNPAID';
};

// ─────────────────────────────────────────────
// BOOKING SYNC HELPER
// Sync booking's advancePaid + paymentStatus after
// an invoice payment lands against a booking.
// Non-blocking — runs outside the transaction.
// ─────────────────────────────────────────────

const syncBookingPaymentStatus = async (bookingId) => {
  if (!bookingId) return;
  try {
    // Pull the booking's totalAmount
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, totalAmount: true },
    });
    if (!booking) return;

    // Sum ALL BookingPayments for this booking
    const bookingAgg = await prisma.bookingPayment.aggregate({
      where: { bookingId },
      _sum: { amount: true },
    });
    const fromBookingPayments = bookingAgg._sum.amount ?? 0;

    // ALSO sum InvoicePayments linked to this booking via GstInvoice
    // (so invoice payments also contribute to the booking's paid total)
    const invoiceAgg = await prisma.invoicePayment.aggregate({
      where: { invoice: { bookingId } },
      _sum: { amount: true },
    });
    const fromInvoicePayments = invoiceAgg._sum.amount ?? 0;

    const totalPaid = parseFloat((fromBookingPayments + fromInvoicePayments).toFixed(2));
    const totalAmount = booking.totalAmount ?? 0;

    // Determine paymentStatus
    let paymentStatus = 'PENDING';
    if (totalAmount > 0) {
      if (totalPaid >= totalAmount) paymentStatus = 'PAID';
      else if (totalPaid > 0) paymentStatus = 'PARTIAL';
    } else if (totalPaid > 0) {
      paymentStatus = 'PARTIAL';
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data: { advancePaid: totalPaid, paymentStatus },
    });
  } catch (err) {
    console.error('[InvoiceService] syncBookingPaymentStatus failed:', err?.message);
  }
};

// ─────────────────────────────────────────────
// VENDOR OUTGOING PAYMENT HELPER
// Creates an OUTGOING UnifiedPayment entry when
// a vendor is linked to an invoice and payment is recorded.
// ─────────────────────────────────────────────

const createVendorOutgoingPayment = async ({
  invoiceId,
  vendorId,
  bookingId,
  amount,
  method,
  reference,
  note,
  paidAt,
  createdById,
}) => {
  if (!vendorId) return;
  try {
    await prisma.unifiedPayment.create({
      data: {
        type:        'OUTGOING',
        source:      'INVOICE',
        sourceId:    invoiceId,
        vendorId,
        bookingId:   bookingId ?? null,
        invoiceId,
        amount,
        method:      method ?? 'CASH',
        status:      'PAID',
        reference:   reference ?? null,
        note:        note ? `[Vendor payment] ${note}` : '[Vendor payment from invoice]',
        paidAt:      paidAt ? new Date(paidAt) : new Date(),
        createdById: createdById ?? null,
      },
    });
  } catch (err) {
    console.error('[InvoiceService] createVendorOutgoingPayment failed:', err?.message);
  }
};

// ─────────────────────────────────────────────
// COMPANY SETTINGS
// ─────────────────────────────────────────────

const getCompanySettings = async () => {
  let settings = await prisma.companySettings.findFirst();
  if (!settings) {
    settings = await prisma.companySettings.create({ data: {} });
  }
  return settings;
};

const updateCompanySettings = async (data) => {
  const existing = await prisma.companySettings.findFirst();
  if (existing) {
    return prisma.companySettings.update({ where: { id: existing.id }, data });
  }
  return prisma.companySettings.create({ data });
};

const resetInvoiceNumbering = async ({ resetTo = 0 } = {}) => {
  const existing = await prisma.companySettings.findFirst();
  if (!existing) throw new AppError('Company settings not found', 404);

  return prisma.companySettings.update({
    where: { id: existing.id },
    data: {
      lastInvoiceNumber: resetTo,
      lastResetYear: null,
    },
  });
};

// ─────────────────────────────────────────────
// FULL INCLUDE — reused across queries
// ─────────────────────────────────────────────

const invoiceFullInclude = {
  items:    { orderBy: { position: 'asc' } },
  payments: { orderBy: { paidAt: 'desc' } },
  customer: { select: { id: true, name: true, phone: true, email: true } },
  // vendor included so front-end can display linked vendor name
  vendor:   { select: { id: true, name: true, phone: true, serviceType: true } },
  createdBy: { select: { id: true, name: true } },
};

// ─────────────────────────────────────────────
// CREATE INVOICE
// ─────────────────────────────────────────────

const createInvoice = async (data, requestingUser) => {
  const {
    customerId, bookingId, vendorId,
    billingName, billingAddress, billingState, billingPhone, billingEmail, customerGstin,
    issueDate, dueDate, items, discountType, discountValue, gstRate, gstType, notes, terms,
  } = data;

  if (vendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
    if (!vendor) throw new AppError('Vendor not found', 404);
  }

  const companySettings = await getCompanySettings();
  const totals = calculateInvoiceTotals({ items, discountType, discountValue, gstRate, gstType });

  // ── Invoice number bahar generate karo (timeout fix) ──
  const updatedSettings = await prisma.companySettings.update({
    where: { id: companySettings.id },
    data: { lastInvoiceNumber: { increment: 1 } },
  });
  const nextNumber = updatedSettings.lastInvoiceNumber;
  const prefix = companySettings.invoicePrefix || 'INV';
  const padded = String(nextNumber).padStart(3, '0');
  const currentYear = new Date().getFullYear();
  const invoiceNumber = companySettings.invoiceNumberFormat === 'YEARLY'
    ? `${prefix}-${currentYear}-${padded}`
    : `${prefix}-${padded}`;

  // ── Status: PAID set karo, paidAmount = totalAmount ──
  const initialStatus = 'PAID';
  const initialPaidAmount = totals.totalAmount;
  const initialDueAmount = 0;

  // ── Sirf writes transaction mein ──
  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.gstInvoice.create({
      data: {
        invoiceNumber,
        status: initialStatus,
        customerId:  customerId ?? null,
        bookingId:   bookingId  ?? null,
        vendorId:    vendorId   ?? null,
        billingName,
        billingAddress: billingAddress ?? null,
        billingState:   billingState   ?? null,
        billingPhone:   billingPhone   ?? null,
        billingEmail:   billingEmail   ?? null,
        customerGstin:  customerGstin  ?? null,
        issueDate: issueDate ? new Date(issueDate) : new Date(),
        dueDate:   dueDate   ? new Date(dueDate)   : null,
        subtotal:       totals.subtotal,
        discountType:   discountType  ?? null,
        discountValue:  discountValue ?? 0,
        discountAmount: totals.discountAmount,
        gstRate, gstType,
        cgstRate: totals.cgstRate, sgstRate: totals.sgstRate, igstRate: totals.igstRate,
        cgstAmount: totals.cgstAmount, sgstAmount: totals.sgstAmount, igstAmount: totals.igstAmount,
        totalGst:    totals.totalGst,
        totalAmount: totals.totalAmount,
        paidAmount:  initialPaidAmount,   // ← total amount = paid
        dueAmount:   initialDueAmount,    // ← 0
        notes: notes ?? null,
        terms: terms ?? companySettings.defaultTerms ?? null,
        companySnapshot: companySettings,
        createdById: requestingUser.id,
        items: {
          create: items.map((item, index) => ({
            description: item.description,
            hsn:      item.hsn ?? null,
            quantity: item.quantity,
            unit:     item.unit ?? null,
            price:    item.price,
            total:    parseFloat((item.quantity * item.price).toFixed(2)),
            position: index,
          })),
        },
      },
      include: invoiceFullInclude,
    });

    // ── InvoicePayment record bhi banao (payments tab mein dikhega) ──
    const payment = await tx.invoicePayment.create({
      data: {
        invoiceId: created.id,
        amount:    totals.totalAmount,
        mode:      'CASH',   // default — baad mein change kar sakte ho
        paidAt:    issueDate ? new Date(issueDate) : new Date(),
        note:      'Auto-recorded on invoice creation (fully paid)',
      },
    });

    return { invoice: created, payment };
  }, { timeout: 10000 });

  // ── Post-transaction: UnifiedPayment ledger mein daalo ──
  setImmediate(async () => {
    try {
      await createFromInvoicePayment({
        invoicePaymentId: invoice.payment.id,
        invoiceId:        invoice.invoice.id,
        customerId:       customerId ?? null,
        bookingId:        bookingId  ?? null,
        amount:           totals.totalAmount,
        method:           'CASH',
        reference:        null,
        note:             'Auto-recorded on invoice creation',
        paidAt:           issueDate ?? null,
        createdById:      requestingUser?.id ?? null,
      });

      if (vendorId) {
        await createVendorOutgoingPayment({
          invoiceId:   invoice.invoice.id,
          vendorId,
          bookingId:   bookingId ?? null,
          amount:      totals.totalAmount,
          method:      'CASH',
          paidAt:      issueDate ?? null,
          createdById: requestingUser?.id ?? null,
        });
      }

      if (bookingId) {
        await syncBookingPaymentStatus(bookingId);
      }
    } catch (err) {
      console.error('[InvoiceService] Post-create sync error:', err?.message);
    }
  });

  return invoice.invoice;
};

// ─────────────────────────────────────────────
// GET ALL INVOICES
// ─────────────────────────────────────────────

const getAllInvoices = async (query, requestingUser) => {
  const {
    page, limit, search, status, customerId, bookingId, vendorId, fromDate, toDate, sort,
  } = query;

  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const where = {
    isDeleted: false,
    ...(status     && { status }),
    ...(customerId && { customerId }),
    ...(bookingId  && { bookingId }),
    ...(vendorId   && { vendorId }),    // ← NEW
    ...(search && {
      OR: [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { billingName:   { contains: search, mode: 'insensitive' } },
        { billingEmail:  { contains: search, mode: 'insensitive' } },
        { billingPhone:  { contains: search, mode: 'insensitive' } },
      ],
    }),
    ...(fromDate && { issueDate: { gte: new Date(fromDate) } }),
    ...(toDate   && { issueDate: { lte: new Date(toDate)   } }),
  };

  const orderBy = (() => {
    switch (sort) {
      case 'oldest':      return { issueDate: 'asc' };
      case 'amount_high': return { totalAmount: 'desc' };
      case 'amount_low':  return { totalAmount: 'asc' };
      default:            return { issueDate: 'desc' };
    }
  })();

  const [invoices, total] = await Promise.all([
    prisma.gstInvoice.findMany({
      where,
      include: {
        items:    { orderBy: { position: 'asc' } },
        payments: true,
        customer: { select: { id: true, name: true, phone: true } },
        vendor:   { select: { id: true, name: true, serviceType: true } },
        createdBy: { select: { id: true, name: true } },
      },
      skip,
      take,
      orderBy,
    }),
    prisma.gstInvoice.count({ where }),
  ]);

  const stats = await prisma.gstInvoice.aggregate({
    where: { isDeleted: false },
    _sum:  { totalAmount: true, paidAmount: true, dueAmount: true },
    _count: { id: true },
  });

  const statusBreakdown = await prisma.gstInvoice.groupBy({
    by:    ['status'],
    where: { isDeleted: false },
    _count: { id: true },
    _sum:   { totalAmount: true },
  });

  return {
    invoices,
    pagination: buildPaginationMeta(total, pageNum, limitNum),
    stats: {
      totalInvoices: stats._count.id,
      totalRevenue:  stats._sum.totalAmount ?? 0,
      totalPaid:     stats._sum.paidAmount  ?? 0,
      totalDue:      stats._sum.dueAmount   ?? 0,
      breakdown:     statusBreakdown,
    },
  };
};

// ─────────────────────────────────────────────
// GET INVOICE BY ID
// ─────────────────────────────────────────────

const getInvoiceById = async (id) => {
  const invoice = await prisma.gstInvoice.findUnique({
    where: { id },
    include: invoiceFullInclude,
  });
  if (!invoice || invoice.isDeleted) throw new AppError('Invoice not found', 404);
  return invoice;
};

const getInvoiceByNumber = async (invoiceNumber) => {
  const invoice = await prisma.gstInvoice.findUnique({
    where: { invoiceNumber },
    include: invoiceFullInclude,
  });
  if (!invoice || invoice.isDeleted) throw new AppError('Invoice not found', 404);
  return invoice;
};

// ─────────────────────────────────────────────
// UPDATE INVOICE
// ─────────────────────────────────────────────

const updateInvoice = async (id, data, requestingUser) => {
  const invoice = await getInvoiceById(id);

  if (['PAID', 'CANCELLED'].includes(invoice.status) && !data.status) {
    throw new AppError('Cannot edit a paid or cancelled invoice', 400);
  }

  // Validate vendor if being changed
  if (data.vendorId !== undefined && data.vendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId }, select: { id: true } });
    if (!vendor) throw new AppError('Vendor not found', 404);
  }

  let updateData = { ...data };

  if (data.items || data.gstRate !== undefined || data.gstType || data.discountType !== undefined) {
    const items = data.items ?? invoice.items.map((i) => ({
      description: i.description,
      hsn:         i.hsn,
      quantity:    i.quantity,
      unit:        i.unit,
      price:       i.price,
    }));

    const totals = calculateInvoiceTotals({
      items,
      discountType:  data.discountType  ?? invoice.discountType,
      discountValue: data.discountValue ?? invoice.discountValue,
      gstRate:       data.gstRate       ?? invoice.gstRate,
      gstType:       data.gstType       ?? invoice.gstType,
    });

    updateData = {
      ...updateData,
      ...totals,
      dueAmount: parseFloat((totals.totalAmount - invoice.paidAmount).toFixed(2)),
    };

    if (data.items) {
      await prisma.gstInvoiceItem.deleteMany({ where: { invoiceId: id } });
    }
  }

  const { items: newItems, ...restUpdateData } = updateData;

  return prisma.gstInvoice.update({
    where: { id },
    data: {
      ...restUpdateData,
      ...(newItems && {
        items: {
          create: newItems.map((item, index) => ({
            description: item.description,
            hsn:         item.hsn  ?? null,
            quantity:    item.quantity,
            unit:        item.unit ?? null,
            price:       item.price,
            total:       parseFloat((item.quantity * item.price).toFixed(2)),
            position:    index,
          })),
        },
      }),
    },
    include: invoiceFullInclude,
  });
};

const updateInvoiceStatus = async (id, status, requestingUser) => {
  const invoice = await getInvoiceById(id);

  const extraData = status === 'PAID'
    ? { paidAmount: invoice.totalAmount, dueAmount: 0 }
    : status === 'UNPAID'
    ? { paidAmount: 0, dueAmount: invoice.totalAmount }
    : {};

  const updated = await prisma.gstInvoice.update({
    where: { id },
    data: { status, ...extraData },
    include: invoiceFullInclude,
  });

  // PAID mark kiya aur abhi tak koi payment nahi thi to banao
  if (status === 'PAID' && invoice.paidAmount < invoice.totalAmount) {
    const remainingAmount = invoice.totalAmount - invoice.paidAmount;

    const payment = await prisma.invoicePayment.create({
      data: {
        invoiceId: id,
        amount:    remainingAmount,
        mode:      'CASH',
        paidAt:    new Date(),
        note:      'Manually marked as paid',
      },
    });

    // UnifiedPayment ledger mein bhi daalo
    setImmediate(async () => {
      try {
        await createFromInvoicePayment({
          invoicePaymentId: payment.id,
          invoiceId:        id,
          customerId:       invoice.customerId ?? null,
          bookingId:        invoice.bookingId  ?? null,
          amount:           remainingAmount,
          method:           'CASH',
          note:             'Manually marked as paid',
          paidAt:           null,
          createdById:      requestingUser?.id ?? null,
        });

        if (invoice.bookingId) {
          await syncBookingPaymentStatus(invoice.bookingId);
        }
      } catch (err) {
        console.error('[InvoiceService] updateInvoiceStatus sync error:', err?.message);
      }
    });
  }

  return updated;
};

// ─────────────────────────────────────────────
// SOFT DELETE INVOICE
// ─────────────────────────────────────────────

const deleteInvoice = async (id) => {
  await getInvoiceById(id);
  return prisma.gstInvoice.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date() },
  });
};

// ─────────────────────────────────────────────
// MARK INVOICE AS SENT
// ─────────────────────────────────────────────

const markInvoiceAsSent = async (id) => {
  const invoice = await getInvoiceById(id);
  if (invoice.status === 'CANCELLED') throw new AppError('Cannot send a cancelled invoice', 400);

  return prisma.gstInvoice.update({
    where: { id },
    data: {
      status: invoice.paidAmount >= invoice.totalAmount ? 'PAID'
        : invoice.paidAmount > 0 ? 'PARTIAL'
        : 'SENT',
    },
    include: invoiceFullInclude,
  });
};

// ─────────────────────────────────────────────
// RECORD PAYMENT  ← MAIN UPDATED FUNCTION
// ─────────────────────────────────────────────

const recordPayment = async (id, data, requestingUser) => {
  const invoice = await getInvoiceById(id);

  if (invoice.status === 'CANCELLED') {
    throw new AppError('Cannot record payment on cancelled invoice', 400);
  }
  if (invoice.paidAmount >= invoice.totalAmount) {
    throw new AppError('Invoice is already fully paid', 400);
  }

  const remaining = invoice.totalAmount - invoice.paidAmount;
  if (data.amount > remaining + 0.01) {
    throw new AppError(`Amount exceeds remaining due: ₹${remaining.toFixed(2)}`, 400);
  }

  const newPaidAmount = parseFloat((invoice.paidAmount + data.amount).toFixed(2));
  const newDueAmount  = parseFloat((invoice.totalAmount - newPaidAmount).toFixed(2));
  const newStatus     = resolveStatus(invoice.totalAmount, newPaidAmount, invoice.status);

  // ── Core transaction: InvoicePayment + GstInvoice update ──────
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.invoicePayment.create({
      data: {
        invoiceId:     id,
        amount:        data.amount,
        mode:          data.mode          ?? 'CASH',
        transactionId: data.transactionId ?? null,
        note:          data.note          ?? null,
        paidAt:        data.paidAt ? new Date(data.paidAt) : new Date(),
      },
    });

    const updated = await tx.gstInvoice.update({
      where: { id },
      data: {
        paidAmount: newPaidAmount,
        dueAmount:  newDueAmount,
        status:     newStatus,
      },
      include: invoiceFullInclude,
    });

    return { invoice: updated, payment };
  });

  // ── Post-transaction async syncs (non-blocking) ───────────────
  setImmediate(async () => {
    try {
      // 1. Sync to Unified Payment Ledger — INCOMING from customer
      await createFromInvoicePayment({
        invoicePaymentId: result.payment.id,
        invoiceId:        id,
        customerId:       invoice.customerId ?? null,
        bookingId:        invoice.bookingId  ?? null,
        amount:           data.amount,
        method:           data.mode          ?? 'CASH',
        reference:        data.transactionId ?? null,
        note:             data.note          ?? null,
        paidAt:           data.paidAt        ?? null,
        createdById:      requestingUser?.id ?? null,
      });

      // 2. If vendor is linked → create OUTGOING payment entry
      if (invoice.vendorId) {
        await createVendorOutgoingPayment({
          invoiceId:   id,
          vendorId:    invoice.vendorId,
          bookingId:   invoice.bookingId  ?? null,
          amount:      data.amount,
          method:      data.mode          ?? 'CASH',
          reference:   data.transactionId ?? null,
          note:        data.note          ?? null,
          paidAt:      data.paidAt        ?? null,
          createdById: requestingUser?.id ?? null,
        });
      }

      // 3. If booking is linked → sync booking's advancePaid + paymentStatus
      if (invoice.bookingId) {
        await syncBookingPaymentStatus(invoice.bookingId);
      }
    } catch (err) {
      console.error('[InvoiceService] Post-payment sync error:', err?.message);
    }
  });
  // ─────────────────────────────────────────────────────────────

  return result;
};

// ─────────────────────────────────────────────
// GET INVOICE PAYMENTS
// ─────────────────────────────────────────────

const getInvoicePayments = async (id) => {
  await getInvoiceById(id);
  return prisma.invoicePayment.findMany({
    where:   { invoiceId: id },
    orderBy: { paidAt: 'desc' },
  });
};

// ─────────────────────────────────────────────
// GET INVOICES BY CUSTOMER
// ─────────────────────────────────────────────

const getCustomerInvoices = async (customerId) => {
  return prisma.gstInvoice.findMany({
    where:   { customerId, isDeleted: false },
    include: {
      items:    { orderBy: { position: 'asc' } },
      payments: true,
      vendor:   { select: { id: true, name: true, serviceType: true } },
    },
    orderBy: { issueDate: 'desc' },
  });
};

// ─────────────────────────────────────────────
// GET INVOICES BY BOOKING
// ─────────────────────────────────────────────

const getBookingInvoices = async (bookingId) => {
  return prisma.gstInvoice.findMany({
    where:   { bookingId, isDeleted: false },
    include: {
      items:    { orderBy: { position: 'asc' } },
      payments: true,
      customer: { select: { id: true, name: true, phone: true } },
      vendor:   { select: { id: true, name: true, serviceType: true } },
    },
    orderBy: { issueDate: 'desc' },
  });
};

// ─────────────────────────────────────────────
// GET INVOICES BY VENDOR  ← NEW
// ─────────────────────────────────────────────

const getVendorInvoices = async (vendorId) => {
  return prisma.gstInvoice.findMany({
    where:   { vendorId, isDeleted: false },
    include: {
      items:    { orderBy: { position: 'asc' } },
      payments: true,
      customer: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { issueDate: 'desc' },
  });
};

// ─────────────────────────────────────────────
// DUPLICATE INVOICE
// ─────────────────────────────────────────────

const duplicateInvoice = async (id, requestingUser) => {
  const source = await getInvoiceById(id);
  const companySettings = await getCompanySettings();

  // ── Number bahar generate karo ──
  const updatedSettings = await prisma.companySettings.update({
    where: { id: companySettings.id },
    data: { lastInvoiceNumber: { increment: 1 } },
  });
  const nextNumber = updatedSettings.lastInvoiceNumber;
  const prefix = companySettings.invoicePrefix || 'INV';
  const padded = String(nextNumber).padStart(3, '0');
  const currentYear = new Date().getFullYear();
  const invoiceNumber = companySettings.invoiceNumberFormat === 'YEARLY'
    ? `${prefix}-${currentYear}-${padded}`
    : `${prefix}-${padded}`;

  return prisma.$transaction(async (tx) => {

    return tx.gstInvoice.create({
      data: {
        invoiceNumber,
        status:        'DRAFT',
        customerId:    source.customerId,
        bookingId:     source.bookingId,
        vendorId:      source.vendorId,    // ← NEW: carry vendor over
        billingName:   source.billingName,
        billingAddress: source.billingAddress,
        billingState:  source.billingState,
        billingPhone:  source.billingPhone,
        billingEmail:  source.billingEmail,
        customerGstin: source.customerGstin,
        issueDate:     new Date(),
        dueDate:       source.dueDate,
        subtotal:      source.subtotal,
        discountType:  source.discountType,
        discountValue: source.discountValue,
        discountAmount: source.discountAmount,
        gstRate:       source.gstRate,
        gstType:       source.gstType,
        cgstRate:      source.cgstRate,
        sgstRate:      source.sgstRate,
        igstRate:      source.igstRate,
        cgstAmount:    source.cgstAmount,
        sgstAmount:    source.sgstAmount,
        igstAmount:    source.igstAmount,
        totalGst:      source.totalGst,
        totalAmount:   source.totalAmount,
        paidAmount:    0,
        dueAmount:     source.totalAmount,
        notes:         source.notes,
        terms:         source.terms,
        companySnapshot: companySettings,
        createdById:   requestingUser.id,
        items: {
          create: source.items.map((item) => ({
            description: item.description,
            hsn:         item.hsn,
            quantity:    item.quantity,
            unit:        item.unit,
            price:       item.price,
            total:       item.total,
            position:    item.position,
          })),
        },
      },
      include: invoiceFullInclude,
    });
  });
};

// ─────────────────────────────────────────────
// INVOICE SUMMARY / DASHBOARD STATS
// ─────────────────────────────────────────────

const getInvoiceDashboard = async () => {
  const now = new Date();
  const startOfMonth     = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth   = new Date(now.getFullYear(), now.getMonth(), 0);

  const [thisMonth, lastMonth, overdue, recentInvoices] = await Promise.all([
    prisma.gstInvoice.aggregate({
      where: { isDeleted: false, issueDate: { gte: startOfMonth } },
      _sum:  { totalAmount: true, paidAmount: true },
      _count: { id: true },
    }),
    prisma.gstInvoice.aggregate({
      where: {
        isDeleted: false,
        issueDate: { gte: startOfLastMonth, lte: endOfLastMonth },
      },
      _sum:  { totalAmount: true },
      _count: { id: true },
    }),
    prisma.gstInvoice.count({
      where: {
        isDeleted: false,
        status:    { in: ['UNPAID', 'PARTIAL'] },
        dueDate:   { lt: now },
      },
    }),
    prisma.gstInvoice.findMany({
      where:   { isDeleted: false },
      orderBy: { issueDate: 'desc' },
      take:    5,
      include: {
        customer: { select: { id: true, name: true } },
        vendor:   { select: { id: true, name: true } },
      },
    }),
  ]);

  return {
    thisMonth: {
      total: thisMonth._sum.totalAmount ?? 0,
      paid:  thisMonth._sum.paidAmount  ?? 0,
      count: thisMonth._count.id,
    },
    lastMonth: {
      total: lastMonth._sum.totalAmount ?? 0,
      count: lastMonth._count.id,
    },
    overdueCount:    overdue,
    recentInvoices,
  };
};

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

export default {
  // Company Settings
  getCompanySettings,
  updateCompanySettings,
  resetInvoiceNumbering,

  // Invoices
  createInvoice,
  getAllInvoices,
  getInvoiceById,
  getInvoiceByNumber,
  updateInvoice,
  deleteInvoice,
  markInvoiceAsSent,
  duplicateInvoice,

  // Payments
  recordPayment,
  getInvoicePayments,

  // Linked
  getCustomerInvoices,
  getBookingInvoices,
  getVendorInvoices,    // ← NEW

  // Dashboard
  getInvoiceDashboard,

  // Internal utility (exported for reuse)
  calculateInvoiceTotals,
  updateInvoiceStatus,
};