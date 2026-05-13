import prisma from '../../config/db.js';
import { AppError, getPagination, buildPaginationMeta } from '../../utils/helpers.js';

// ─────────────────────────────────────────────
// CONSTANTS & HELPERS
// ─────────────────────────────────────────────

const paymentInclude = {
  customer: { select: { id: true, name: true, phone: true, email: true } },
  booking: {
    select: {
      id: true,
      status: true,
      travelStart: true,
      travelEnd: true,
      totalAmount: true,
      advancePaid: true,
      paymentStatus: true,
    },
  },
  invoices: true,
};

const generateInvoiceNumber = () => {
  const date = new Date();
  const prefix = 'INV';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `${prefix}-${year}${month}-${random}`;
};

const generateReceiptNumber = () => {
  const date = new Date();
  const prefix = 'RCP';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `${prefix}-${year}${month}-${random}`;
};

/**
 * Recalculate and update booking payment status
 * after any payment create/update/delete
 */
const syncBookingPaymentStatus = async (bookingId) => {
  if (!bookingId) return;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payments: true },
  });
  if (!booking) return;

  const totalPaid = booking.payments.reduce(
    (sum, p) => sum + (p.paidAmount ?? 0),
    0
  );
  const totalAmount = booking.totalAmount ?? 0;
  const remaining = Math.max(0, totalAmount - totalPaid);

  let paymentStatus = 'PENDING';
  if (totalPaid >= totalAmount && totalAmount > 0) paymentStatus = 'PAID';
  else if (totalPaid > 0) paymentStatus = 'PARTIAL';

  await prisma.booking.update({
    where: { id: bookingId },
    data: { advancePaid: totalPaid, paymentStatus },
  });

  return { totalPaid, remaining, paymentStatus };
};

/**
 * Log payment-related activity to CustomerActivityLog
 */
const logActivity = async ({
  customerId,
  type,
  title,
  description,
  metadata,
  performedById,
}) => {
  try {
    await prisma.customerActivityLog.create({
      data: {
        customerId,
        type,
        title,
        description,
        metadata,
        performedById,
      },
    });
  } catch (_) {
    // Non-blocking — activity log failure should not break the flow
  }
};

// ─────────────────────────────────────────────
// PAYMENTS — CRUD
// ─────────────────────────────────────────────

export const getAllPayments = async (
  { page, limit, status, customerId, bookingId, mode, startDate, endDate, search, sort },
  requestingUser
) => {
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const where = {
    ...(status && { status }),
    ...(customerId && { customerId }),
    ...(bookingId && { bookingId }),
    ...(mode && { mode }),
    ...(requestingUser?.role === 'AGENT' && {
      customer: { assignedToId: requestingUser.id },
    }),
    ...(startDate || endDate
      ? {
          createdAt: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        }
      : {}),
    ...(search && {
      OR: [
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { phone: { contains: search, mode: 'insensitive' } } },
      ],
    }),
  };

  // Sort options: latest (default), oldest, highest, lowest
  const orderBy =
    sort === 'highest'
      ? { amount: 'desc' }
      : sort === 'lowest'
      ? { amount: 'asc' }
      : sort === 'oldest'
      ? { createdAt: 'asc' }
      : { createdAt: 'desc' };

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({ where, include: paymentInclude, skip, take, orderBy }),
    prisma.payment.count({ where }),
  ]);

  const summary = await prisma.payment.aggregate({
    where,
    _sum: { amount: true, paidAmount: true, dueAmount: true },
  });

  return {
    payments,
    pagination: buildPaginationMeta(total, pageNum, limitNum),
    summary: summary._sum,
  };
};

export const getPaymentById = async (id) => {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: paymentInclude,
  });
  if (!payment) throw new AppError('Payment not found', 404);
  return payment;
};

export const createPayment = async (data, userId) => {
  const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
  if (!customer) throw new AppError('Customer not found', 404);

  if (data.bookingId) {
    const booking = await prisma.booking.findUnique({ where: { id: data.bookingId } });
    if (!booking) throw new AppError('Booking not found', 404);
  }

  // Auto-derive status from amounts
  if (data.amount !== undefined && data.paidAmount !== undefined) {
    if (data.paidAmount >= data.amount) data.status = 'PAID';
    else if (data.paidAmount > 0) data.status = 'PARTIALLY_PAID';
    else data.status = 'UNPAID';
    data.dueAmount = Math.max(0, data.amount - data.paidAmount);
  }

  // Strip unknown fields & empty strings before Prisma call
  const ALLOWED_FIELDS = [
    'customerId', 'bookingId', 'amount', 'mode', 'status',
    'dueAmount', 'paidAmount', 'notes', 'paidAt',
  ];
  const prismaData = {};
  for (const key of ALLOWED_FIELDS) {
    if (data[key] !== undefined && data[key] !== '') {
      prismaData[key] = data[key];
    }
  }

  const payment = await prisma.payment.create({
    data: {
      ...prismaData,
      paidAt: prismaData.paidAt ? new Date(prismaData.paidAt) : (prismaData.paidAmount > 0 ? new Date() : null),
    },
    include: paymentInclude,
  });

  // Sync booking payment status
  await syncBookingPaymentStatus(data.bookingId);

  // Activity log
  await logActivity({
    customerId: data.customerId,
    type: 'PAYMENT_RECEIVED',
    title: `Payment of ₹${data.paidAmount ?? data.amount} received`,
    description: `Mode: ${data.mode}. Notes: ${data.notes ?? '—'}`,
    metadata: { paymentId: payment.id, bookingId: data.bookingId },
    performedById: userId,
  });

  return payment;
};

export const updatePayment = async (id, data, userId) => {
  const existing = await getPaymentById(id);

  const amount = data.amount ?? existing.amount;
  const paidAmount = data.paidAmount ?? existing.paidAmount ?? 0;

  if (data.amount !== undefined || data.paidAmount !== undefined) {
    if (paidAmount >= amount) data.status = 'PAID';
    else if (paidAmount > 0) data.status = 'PARTIALLY_PAID';
    else data.status = 'UNPAID';
    data.dueAmount = Math.max(0, amount - paidAmount);
  }

  const payment = await prisma.payment.update({
    where: { id },
    data,
    include: paymentInclude,
  });

  await syncBookingPaymentStatus(existing.bookingId);

  await logActivity({
    customerId: existing.customerId,
    type: 'PAYMENT_RECEIVED',
    title: `Payment updated — ₹${paidAmount} paid`,
    metadata: { paymentId: id },
    performedById: userId,
  });

  return payment;
};

export const deletePayment = async (id, userId) => {
  const existing = await getPaymentById(id);
  await prisma.payment.delete({ where: { id } });
  await syncBookingPaymentStatus(existing.bookingId);
  return true;
};

// ─────────────────────────────────────────────
// BOOKING — PAYMENT SUMMARY
// ─────────────────────────────────────────────

export const getBookingPaymentSummary = async (bookingId) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      payments: { include: { invoices: true }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!booking) throw new AppError('Booking not found', 404);

  const totalPaid = booking.payments.reduce((sum, p) => sum + (p.paidAmount ?? 0), 0);
  const totalAmount = booking.totalAmount ?? 0;
  const remainingAmount = Math.max(0, totalAmount - totalPaid);

  let paymentStatus = 'PENDING';
  if (totalPaid >= totalAmount && totalAmount > 0) paymentStatus = 'PAID';
  else if (totalPaid > 0) paymentStatus = 'PARTIAL';

  return {
    booking,
    summary: { totalAmount, totalPaid, remainingAmount, paymentStatus },
    payments: booking.payments,
  };
};

// ─────────────────────────────────────────────
// CUSTOMER — PAYMENT SUMMARY
// ─────────────────────────────────────────────

export const getCustomerPaymentSummary = async (customerId) => {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      payments: {
        include: {
          booking: { select: { id: true, travelStart: true, status: true } },
          invoices: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!customer) throw new AppError('Customer not found', 404);

  const totalSpend = customer.payments.reduce((sum, p) => sum + (p.paidAmount ?? 0), 0);
  const pendingAmount = customer.payments.reduce((sum, p) => sum + (p.dueAmount ?? 0), 0);

  return {
    customer,
    summary: { totalSpend, pendingAmount },
    paymentHistory: customer.payments,
  };
};

// ─────────────────────────────────────────────
// RECEIPT (PAYMENT SLIP)
// ─────────────────────────────────────────────

export const getPaymentReceipt = async (paymentId) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      customer: true,
      booking: {
        include: {
          hotelBookings: true,
          flightBookings: true,
          transportBookings: true,
        },
      },
      invoices: true,
    },
  });
  if (!payment) throw new AppError('Payment not found', 404);

  const receiptNumber = generateReceiptNumber();

  return {
    receiptNumber,
    payment,
    customer: payment.customer,
    booking: payment.booking,
    generatedAt: new Date().toISOString(),
  };
};

// ─────────────────────────────────────────────
// INVOICES
// ─────────────────────────────────────────────

export const createPaymentInvoice = async ({ paymentId, amount, notes }) => {
  const payment = await getPaymentById(paymentId);

  return prisma.invoice.create({
    data: {
      paymentId,
      amount,
      notes,
      invoiceNumber: generateInvoiceNumber(),
    },
  });
};

/**
 * Full booking invoice — aggregates all payments, booking items, hotel/flight/transport
 */
export const createBookingInvoice = async ({ bookingId, notes, discount = 0, tax = 0 }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: true,
      payments: true,
      hotelBookings: true,
      flightBookings: true,
      transportBookings: true,
      items: true,
      itinerary: { select: { title: true, destination: true } },
    },
  });
  if (!booking) throw new AppError('Booking not found', 404);

  const totalPaid = booking.payments.reduce((sum, p) => sum + (p.paidAmount ?? 0), 0);
  const totalAmount = booking.totalAmount ?? 0;
  const remainingAmount = Math.max(0, totalAmount - totalPaid);

  // Generate invoice on the first payment if exists, else create standalone
  let paymentId = booking.payments[0]?.id ?? null;

  // Create a dummy payment record if none exists (so invoice FK is satisfied)
  if (!paymentId) {
    const dummyPayment = await prisma.payment.create({
      data: {
        customerId: booking.customerId,
        bookingId,
        amount: totalAmount,
        paidAmount: totalPaid,
        dueAmount: remainingAmount,
        mode: 'CASH',
        status: totalPaid >= totalAmount ? 'PAID' : totalPaid > 0 ? 'PARTIALLY_PAID' : 'UNPAID',
      },
    });
    paymentId = dummyPayment.id;
  }

  const invoice = await prisma.invoice.create({
    data: {
      paymentId,
      amount: totalAmount,
      notes,
      invoiceNumber: generateInvoiceNumber(),
    },
    include: {
      payment: {
        include: { customer: true, booking: true },
      },
    },
  });

  // Build full invoice data for PDF rendering
  return {
    invoice,
    booking,
    customer: booking.customer,
    summary: {
      totalAmount,
      totalPaid,
      remainingAmount,
      discount,
      tax,
      grandTotal: totalAmount - discount + tax,
    },
    lineItems: [
      ...booking.hotelBookings.map((h) => ({
        type: 'Hotel',
        description: `${h.hotelName} — ${h.city} (${h.nights} nights, ${h.roomType})`,
        nights: h.nights,
        rooms: h.rooms,
      })),
      ...booking.flightBookings.map((f) => ({
        type: 'Flight',
        description: `${f.from} → ${f.to} | ${f.airline ?? ''} ${f.flightNumber ?? ''} (${f.travelClass})`,
      })),
      ...booking.transportBookings.map((t) => ({
        type: 'Transport',
        description: `${t.vehicleType} — ${t.pickup} to ${t.drop}`,
      })),
      ...booking.items.map((i) => ({
        type: i.type,
        description: i.description ?? '',
        amount: i.amount,
      })),
    ],
  };
};

export const getInvoiceById = async (id) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      payment: {
        include: {
          customer: true,
          booking: {
            include: {
              hotelBookings: true,
              flightBookings: true,
              transportBookings: true,
              items: true,
            },
          },
        },
      },
    },
  });
  if (!invoice) throw new AppError('Invoice not found', 404);
  return invoice;
};

export const getInvoicesByBooking = async (bookingId) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payments: { include: { invoices: true } } },
  });
  if (!booking) throw new AppError('Booking not found', 404);

  const invoices = booking.payments.flatMap((p) => p.invoices);
  return invoices;
};

// ─────────────────────────────────────────────
// EXPORT — CSV / EXCEL
// ─────────────────────────────────────────────

export const exportPayments = async (filters, requestingUser) => {
  const { status, customerId, bookingId, mode, startDate, endDate } = filters;

  const where = {
    ...(status && { status }),
    ...(customerId && { customerId }),
    ...(bookingId && { bookingId }),
    ...(mode && { mode }),
    ...(requestingUser?.role === 'AGENT' && {
      customer: { assignedToId: requestingUser.id },
    }),
    ...(startDate || endDate
      ? {
          createdAt: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        }
      : {}),
  };

  const payments = await prisma.payment.findMany({
    where,
    include: paymentInclude,
    orderBy: { createdAt: 'desc' },
  });

  // Flatten for CSV/Excel
  const rows = payments.map((p) => ({
    'Payment ID': p.id,
    'Customer Name': p.customer?.name ?? '',
    'Customer Phone': p.customer?.phone ?? '',
    'Booking ID': p.bookingId ?? '',
    'Total Amount': p.amount,
    'Paid Amount': p.paidAmount ?? 0,
    'Due Amount': p.dueAmount ?? 0,
    'Payment Mode': p.mode,
    Status: p.status,
    'Transaction ID': p.transactionId ?? '',
    Notes: p.notes ?? '',
    'Paid At': p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-IN') : '',
    'Created At': new Date(p.createdAt).toLocaleDateString('en-IN'),
  }));

  return rows;
};

// ─────────────────────────────────────────────
// PAYMENT REMINDERS & CONFIRMATIONS
// ─────────────────────────────────────────────

/**
 * Build due-payment reminder message from template
 */
export const buildReminderMessage = async (bookingId, customMessage) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { customer: true, payments: true },
  });
  if (!booking) throw new AppError('Booking not found', 404);

  const totalPaid = booking.payments.reduce((sum, p) => sum + (p.paidAmount ?? 0), 0);
  const remaining = Math.max(0, (booking.totalAmount ?? 0) - totalPaid);
  const startDate = booking.travelStart
    ? new Date(booking.travelStart).toLocaleDateString('en-IN')
    : 'your upcoming trip';

  const defaultMessage =
    `Hi ${booking.customer.name},\n` +
    `Your remaining amount ₹${remaining} is pending for your trip starting on ${startDate}.\n` +
    `Please complete the payment. Thank you!`;

  return {
    booking,
    customer: booking.customer,
    remaining,
    message: customMessage ?? defaultMessage,
  };
};

/**
 * Build payment confirmation message from template
 */
export const buildConfirmationMessage = async (paymentId, customMessage) => {
  const payment = await getPaymentById(paymentId);

  const defaultMessage =
    `Hi ${payment.customer.name},\n` +
    `We have received your payment of ₹${payment.paidAmount ?? payment.amount} successfully. Thank you!`;

  return {
    payment,
    customer: payment.customer,
    message: customMessage ?? defaultMessage,
  };
};

/**
 * Send payment reminder (logs to CustomerCommunication)
 */
export const sendPaymentReminder = async (
  { bookingId, channel, message, attachInvoice, attachReceipt, paymentId },
  userId
) => {
  const { booking, customer, remaining, message: resolvedMessage } =
    await buildReminderMessage(bookingId, message);

  // Save communication record
  const communication = await prisma.customerCommunication.create({
    data: {
      customerId: customer.id,
      channel,
      status: 'SENT',
      subject: channel === 'EMAIL' ? `Payment Reminder — ₹${remaining} due` : null,
      message: resolvedMessage,
      sentById: userId,
    },
  });

  // Activity log
  await logActivity({
    customerId: customer.id,
    type: channel === 'WHATSAPP' ? 'WHATSAPP_SENT' : 'EMAIL_SENT',
    title: `Payment reminder sent via ${channel}`,
    description: `Remaining ₹${remaining} for booking ${bookingId}`,
    metadata: { bookingId, communicationId: communication.id, attachInvoice, attachReceipt, paymentId },
    performedById: userId,
  });

  return {
    success: true,
    communication,
    message: resolvedMessage,
    customer,
    remaining,
  };
};

/**
 * Send payment confirmation (logs to CustomerCommunication)
 */
export const sendPaymentConfirmation = async (
  { paymentId, channel, message, attachReceipt },
  userId
) => {
  const { payment, customer, message: resolvedMessage } =
    await buildConfirmationMessage(paymentId, message);

  const communication = await prisma.customerCommunication.create({
    data: {
      customerId: customer.id,
      channel,
      status: 'SENT',
      subject: channel === 'EMAIL' ? `Payment Confirmation — ₹${payment.paidAmount ?? payment.amount} received` : null,
      message: resolvedMessage,
      sentById: userId,
    },
  });

  await logActivity({
    customerId: customer.id,
    type: channel === 'WHATSAPP' ? 'WHATSAPP_SENT' : 'EMAIL_SENT',
    title: `Payment confirmation sent via ${channel}`,
    description: `₹${payment.paidAmount ?? payment.amount} confirmed for payment ${paymentId}`,
    metadata: { paymentId, communicationId: communication.id, attachReceipt },
    performedById: userId,
  });

  return {
    success: true,
    communication,
    message: resolvedMessage,
    customer,
    payment,
  };
};

/**
 * Send invoice via channel
 */
export const sendInvoice = async ({ invoiceId, channel, message }, userId) => {
  const invoice = await getInvoiceById(invoiceId);
  const customer = invoice.payment.customer;

  const defaultMessage =
    `Hi ${customer.name},\n` +
    `Please find your invoice ${invoice.invoiceNumber} for ₹${invoice.amount} attached.\n` +
    `Thank you for choosing us!`;

  const communication = await prisma.customerCommunication.create({
    data: {
      customerId: customer.id,
      channel,
      status: 'SENT',
      subject: channel === 'EMAIL' ? `Invoice ${invoice.invoiceNumber}` : null,
      message: message ?? defaultMessage,
      sentById: userId,
    },
  });

  await logActivity({
    customerId: customer.id,
    type: channel === 'WHATSAPP' ? 'WHATSAPP_SENT' : 'EMAIL_SENT',
    title: `Invoice ${invoice.invoiceNumber} sent via ${channel}`,
    metadata: { invoiceId, communicationId: communication.id },
    performedById: userId,
  });

  return { success: true, communication, invoice };
};

// ─────────────────────────────────────────────
// PAYMENT ACTIVITY LOG (per payment)
// ─────────────────────────────────────────────

export const getPaymentActivityLog = async (paymentId) => {
  const payment = await getPaymentById(paymentId);

  const logs = await prisma.customerActivityLog.findMany({
    where: {
      customerId: payment.customerId,
      metadata: { path: ['paymentId'], equals: paymentId },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      performedBy: { select: { id: true, name: true, role: true } },
    },
  });

  return logs;
};