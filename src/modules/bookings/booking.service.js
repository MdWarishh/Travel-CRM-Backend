import prisma from '../../config/db.js';
import nodemailer from 'nodemailer';
import { AppError, getPagination, buildPaginationMeta } from '../../utils/helpers.js';
import { differenceInDays, isSameDay, isPast } from 'date-fns';

// ─── Default checklist tasks ──────────────────
const DEFAULT_TASKS = [
  'Hotel confirmed',
  'Flight tickets issued',
  'Driver assigned',
  'Voucher sent to client',
  'Client informed before travel',
];

// ─── Vendor select shape (reused everywhere) ──
const VENDOR_SELECT = {
  id: true,
  name: true,
  serviceType: true,
  types: true,
  phone: true,
  email: true,
  city: true,
  isPreferred: true,
};

// ─── LIST view — lean select, no nested includes ──────────────
const BOOKING_LIST_SELECT = {
  id: true,
  status: true,
  tripStatus: true,
  paymentStatus: true,
  travelStart: true,
  travelEnd: true,
  totalDays: true,
  totalAmount: true,
  advancePaid: true,
  pricePerAdult: true,
  pricePerChild: true,
  adults: true,
  children: true,
  tourDays: true,
  createdAt: true,
  customer: { select: { id: true, name: true, phone: true, email: true } },
  _count: {
    select: { hotelBookings: true, flightBookings: true, travellers: true, tasks: true },
  },
};

// ─── DETAIL view include — vendor added per service ───────────
export const bookingInclude = {
  customer: { select: { id: true, name: true, phone: true, email: true } },
  itinerary: {
    select: {
      id: true,
      title: true,
      destination: true,
      days: {
        orderBy: { dayNumber: 'asc' },
        select: { id: true, dayNumber: true, title: true, description: true },
      },
    },
  },
  items: {
    include: { vendor: { select: VENDOR_SELECT } },
    orderBy: { createdAt: 'asc' },
  },
  // vendor exposed per service type
  hotelBookings: {
    orderBy: { checkIn: 'asc' },
    include: { vendor: { select: VENDOR_SELECT } },
  },
  flightBookings: {
    orderBy: { departure: 'asc' },
    include: { vendor: { select: VENDOR_SELECT } },
  },
  transportBookings: {
    orderBy: { datetime: 'asc' },
    include: { vendor: { select: VENDOR_SELECT } },
  },
  logs: { orderBy: { createdAt: 'desc' }, take: 30 },
  tasks: { orderBy: { createdAt: 'asc' } },
  travellers: { orderBy: { createdAt: 'asc' } },
  days: { orderBy: { dayNumber: 'asc' } },
  bookingPayments: { orderBy: { paidAt: 'desc' } },
};

// ─── Pure helpers ─────────────────────────────
function calcTripStatus(travelStart, travelEnd) {
  if (!travelStart) return 'UPCOMING';
  const now = new Date();
  const start = new Date(travelStart);
  const end = travelEnd ? new Date(travelEnd) : null;
  if (end && isPast(end)) return 'COMPLETED';
  if (isSameDay(start, now) || (start <= now && (!end || end >= now))) return 'ONGOING';
  return 'UPCOMING';
}

function calcTotalAmount(data) {
  const adults = data.adults ?? 0;
  const children = data.children ?? 0;
  const pricePerAdult = data.pricePerAdult ?? 0;
  const pricePerChild = data.pricePerChild ?? 0;
  if (pricePerAdult > 0) return pricePerAdult * adults + pricePerChild * children;
  return data.totalAmount ?? null;
}

function calcPaymentStatus(totalAmount, totalPaid) {
  if (!totalAmount || totalAmount <= 0) return totalPaid > 0 ? 'PARTIAL' : 'PENDING';
  if (totalPaid >= totalAmount) return 'PAID';
  if (totalPaid > 0) return 'PARTIAL';
  return 'PENDING';
}

export const addLog = (bookingId, message, type = 'SYSTEM') =>
  prisma.bookingLog.create({ data: { bookingId, message, type } }).catch(() => {});

const assertBookingExists = async (bookingId) => {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true } });
  if (!b) throw new AppError('Booking not found', 404);
  return b;
};

// ─── Vendor type guard ────────────────────────
// expectedType must match vendor.types[] or vendor.serviceType (legacy)
async function assertVendorType(vendorId, expectedType) {
  if (!vendorId) return;
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, name: true, types: true, serviceType: true, status: true },
  });
  if (!vendor) throw new AppError(`Vendor not found: ${vendorId}`, 404);
  if (vendor.status === 'BLACKLISTED')
    throw new AppError(`Vendor "${vendor.name}" is blacklisted`, 400);
  const matched =
    vendor.types.includes(expectedType) || vendor.serviceType === expectedType;
  if (!matched)
    throw new AppError(
      `Vendor "${vendor.name}" is not of type ${expectedType}. Has: ${vendor.types.join(', ') || vendor.serviceType}`,
      400,
    );
}

// ═══════════════════════════════════════════════
// BOOKING CRUD
// ═══════════════════════════════════════════════

export const getAllBookings = async (
  { page, limit, status, tripStatus, customerId, search },
  requestingUser,
) => {
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const where = {
    ...(status && { status }),
    ...(tripStatus && { tripStatus }),
    ...(customerId && { customerId }),
    ...(requestingUser.role === 'AGENT' && {
      customer: { assignedToId: requestingUser.id },
    }),
    ...(search && {
      customer: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ],
      },
    }),
  };

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      select: BOOKING_LIST_SELECT,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.booking.count({ where }),
  ]);

  return { bookings, pagination: buildPaginationMeta(total, pageNum, limitNum) };
};

export const getBookingById = async (id) => {
  const booking = await prisma.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!booking) throw new AppError('Booking not found', 404);
  return booking;
};

export const createBooking = async (data) => {
  const { items, ...bookingData } = data;
  if (bookingData.travelStart) bookingData.travelStart = new Date(bookingData.travelStart);
  if (bookingData.travelEnd) bookingData.travelEnd = new Date(bookingData.travelEnd);
  if (!bookingData.itineraryId) delete bookingData.itineraryId;

  if (bookingData.travelStart && bookingData.travelEnd) {
    const days = differenceInDays(bookingData.travelEnd, bookingData.travelStart);
    bookingData.totalDays = days + 1;
    bookingData.totalNights = days;
  }

  bookingData.tripStatus = calcTripStatus(bookingData.travelStart, bookingData.travelEnd);
  const computedTotal = calcTotalAmount(bookingData);
  if (computedTotal !== null) bookingData.totalAmount = computedTotal;

  const customer = await prisma.customer.findUnique({
    where: { id: bookingData.customerId },
    select: { id: true },
  });
  if (!customer) throw new AppError('Customer not found', 404);

  const booking = await prisma.booking.create({
    data: {
      ...bookingData,
      ...(items && { items: { create: items } }),
      tasks: { create: DEFAULT_TASKS.map((title) => ({ title, isDefault: true })) },
    },
    include: bookingInclude,
  });

  addLog(booking.id, 'Booking created');
  return booking;
};

export const updateBooking = async (id, data) => {
  const existing = await prisma.booking.findUnique({
    where: { id },
    select: { id: true, totalAmount: true },
  });
  if (!existing) throw new AppError('Booking not found', 404);

  const { items, ...bookingData } = data;
  if (bookingData.travelStart) bookingData.travelStart = new Date(bookingData.travelStart);
  if (bookingData.travelEnd) bookingData.travelEnd = new Date(bookingData.travelEnd);

  if (bookingData.travelStart && bookingData.travelEnd) {
    const days = differenceInDays(bookingData.travelEnd, bookingData.travelStart);
    bookingData.totalDays = days + 1;
    bookingData.totalNights = days;
    bookingData.tripStatus = calcTripStatus(bookingData.travelStart, bookingData.travelEnd);
  }

  const computedTotal = calcTotalAmount(bookingData);
  if (computedTotal !== null) bookingData.totalAmount = computedTotal;

  const updated = await prisma.booking.update({
    where: { id },
    data: bookingData,
    include: bookingInclude,
  });
  addLog(id, 'Booking details updated');
  return updated;
};

export const updateBookingStatus = async (id, status) => {
  const existing = await prisma.booking.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError('Booking not found', 404);
  const updated = await prisma.booking.update({
    where: { id },
    data: { status },
    include: bookingInclude,
  });
  addLog(id, `Status changed to ${status}`);
  return updated;
};

export const deleteBooking = async (id) => {
  const existing = await prisma.booking.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError('Booking not found', 404);
  await prisma.booking.delete({ where: { id } });
  return true;
};

// ═══════════════════════════════════════════════
// GENERIC ITEMS
// ═══════════════════════════════════════════════

export const addBookingItem = async (bookingId, data) => {
  await assertBookingExists(bookingId);
  return prisma.bookingItem.create({ data: { ...data, bookingId } });
};

export const updateBookingItem = async (bookingId, itemId, data) => {
  const item = await prisma.bookingItem.findFirst({
    where: { id: itemId, bookingId },
    select: { id: true },
  });
  if (!item) throw new AppError('Booking item not found', 404);
  return prisma.bookingItem.update({ where: { id: itemId }, data });
};

export const deleteBookingItem = async (bookingId, itemId) => {
  const item = await prisma.bookingItem.findFirst({
    where: { id: itemId, bookingId },
    select: { id: true },
  });
  if (!item) throw new AppError('Booking item not found', 404);
  await prisma.bookingItem.delete({ where: { id: itemId } });
  return true;
};

// ═══════════════════════════════════════════════
// HOTEL  —  vendorId support
// ═══════════════════════════════════════════════

const calcNights = (checkIn, checkOut) =>
  Math.max(0, differenceInDays(new Date(checkOut), new Date(checkIn)));

export const addHotelBooking = async (bookingId, data) => {
  await assertBookingExists(bookingId);
  if (data.vendorId) await assertVendorType(data.vendorId, 'HOTEL');

  const nights = calcNights(data.checkIn, data.checkOut);
  const hotel = await prisma.hotelBooking.create({
    data: {
      ...data,
      bookingId,
      checkIn: new Date(data.checkIn),
      checkOut: new Date(data.checkOut),
      nights,
    },
    include: { vendor: { select: VENDOR_SELECT } },
  });
  addLog(
    bookingId,
    `Hotel added: ${data.hotelName}, ${data.city}${data.vendorId ? ' (vendor linked)' : ''}`,
  );
  return hotel;
};

export const updateHotelBooking = async (bookingId, hotelId, data) => {
  const hotel = await prisma.hotelBooking.findFirst({
    where: { id: hotelId, bookingId },
    select: { id: true, nights: true },
  });
  if (!hotel) throw new AppError('Hotel booking not found', 404);
  if (data.vendorId) await assertVendorType(data.vendorId, 'HOTEL');

  const nights =
    data.checkIn && data.checkOut ? calcNights(data.checkIn, data.checkOut) : hotel.nights;

  return prisma.hotelBooking.update({
    where: { id: hotelId },
    data: {
      ...data,
      ...(data.checkIn && { checkIn: new Date(data.checkIn) }),
      ...(data.checkOut && { checkOut: new Date(data.checkOut) }),
      nights,
    },
    include: { vendor: { select: VENDOR_SELECT } },
  });
};

export const deleteHotelBooking = async (bookingId, hotelId) => {
  const hotel = await prisma.hotelBooking.findFirst({
    where: { id: hotelId, bookingId },
    select: { id: true, hotelName: true },
  });
  if (!hotel) throw new AppError('Hotel booking not found', 404);
  await prisma.hotelBooking.delete({ where: { id: hotelId } });
  addLog(bookingId, `Hotel removed: ${hotel.hotelName}`);
  return true;
};

// ═══════════════════════════════════════════════
// FLIGHT  —  vendorId support
// ═══════════════════════════════════════════════

export const addFlightBooking = async (bookingId, data) => {
  await assertBookingExists(bookingId);
  if (data.vendorId) await assertVendorType(data.vendorId, 'AIRLINE');

  const flight = await prisma.flightBooking.create({
    data: {
      ...data,
      bookingId,
      departure: new Date(data.departure),
      arrival: new Date(data.arrival),
    },
    include: { vendor: { select: VENDOR_SELECT } },
  });
  addLog(
    bookingId,
    `Flight added: ${data.from} → ${data.to}${data.vendorId ? ' (vendor linked)' : ''}`,
  );
  return flight;
};

export const updateFlightBooking = async (bookingId, flightId, data) => {
  const flight = await prisma.flightBooking.findFirst({
    where: { id: flightId, bookingId },
    select: { id: true },
  });
  if (!flight) throw new AppError('Flight booking not found', 404);
  if (data.vendorId) await assertVendorType(data.vendorId, 'AIRLINE');

  return prisma.flightBooking.update({
    where: { id: flightId },
    data: {
      ...data,
      ...(data.departure && { departure: new Date(data.departure) }),
      ...(data.arrival && { arrival: new Date(data.arrival) }),
    },
    include: { vendor: { select: VENDOR_SELECT } },
  });
};

// In deleteFlightBooking — add log (currently missing):
export const deleteFlightBooking = async (bookingId, flightId) => {
  const flight = await prisma.flightBooking.findFirst({
    where: { id: flightId, bookingId },
    select: { id: true, from: true, to: true },  // add from/to
  });
  if (!flight) throw new AppError('Flight booking not found', 404);
  await prisma.flightBooking.delete({ where: { id: flightId } });
  addLog(bookingId, `Flight removed: ${flight.from} → ${flight.to}`);  // ← add this
  return true;
};

// ═══════════════════════════════════════════════
// TRANSPORT  —  vendorId support
// ═══════════════════════════════════════════════

export const addTransportBooking = async (bookingId, data) => {
  await assertBookingExists(bookingId);
  if (data.vendorId) await assertVendorType(data.vendorId, 'TRANSPORT');

  const transport = await prisma.transportBooking.create({
    data: { ...data, bookingId, datetime: new Date(data.datetime) },
    include: { vendor: { select: VENDOR_SELECT } },
  });
  addLog(
    bookingId,
    `Transport added: ${data.vehicleType}${data.vendorId ? ' (vendor linked)' : ''}`,
  );
  return transport;
};

export const updateTransportBooking = async (bookingId, transportId, data) => {
  const transport = await prisma.transportBooking.findFirst({
    where: { id: transportId, bookingId },
    select: { id: true },
  });
  if (!transport) throw new AppError('Transport booking not found', 404);
  if (data.vendorId) await assertVendorType(data.vendorId, 'TRANSPORT');

  return prisma.transportBooking.update({
    where: { id: transportId },
    data: { ...data, ...(data.datetime && { datetime: new Date(data.datetime) }) },
    include: { vendor: { select: VENDOR_SELECT } },
  });
};

export const deleteTransportBooking = async (bookingId, transportId) => {
  const transport = await prisma.transportBooking.findFirst({
    where: { id: transportId, bookingId },
    select: { id: true },
  });
  if (!transport) throw new AppError('Transport booking not found', 404);
  await prisma.transportBooking.delete({ where: { id: transportId } });
  return true;
};

// ═══════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════

export const getTasks = async (bookingId) =>
  prisma.bookingTask.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });

export const addTask = async (bookingId, title) => {
  await assertBookingExists(bookingId);
  const task = await prisma.bookingTask.create({ data: { bookingId, title } });
  addLog(bookingId, `Task added: "${title}"`, 'MANUAL');
  return task;
};

export const toggleTask = async (bookingId, taskId) => {
  const task = await prisma.bookingTask.findFirst({ where: { id: taskId, bookingId } });
  if (!task) throw new AppError('Task not found', 404);
  const updated = await prisma.bookingTask.update({
    where: { id: taskId },
    data: {
      isCompleted: !task.isCompleted,
      completedAt: !task.isCompleted ? new Date() : null,
    },
  });
  addLog(
    bookingId,
    `Task "${task.title}" marked ${updated.isCompleted ? 'complete' : 'incomplete'}`,
    'MANUAL',
  );
  return updated;
};

export const deleteTask = async (bookingId, taskId) => {
  const task = await prisma.bookingTask.findFirst({
    where: { id: taskId, bookingId },
    select: { id: true },
  });
  if (!task) throw new AppError('Task not found', 404);
  await prisma.bookingTask.delete({ where: { id: taskId } });
  return true;
};

// ═══════════════════════════════════════════════
// TRAVELLERS
// ═══════════════════════════════════════════════

export const getTravellers = async (bookingId) =>
  prisma.bookingTraveller.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });

export const addTraveller = async (bookingId, data) => {
  await assertBookingExists(bookingId);
  const traveller = await prisma.bookingTraveller.create({ data: { ...data, bookingId } });
  addLog(bookingId, `Traveller added: ${data.name}`, 'MANUAL');
  return traveller;
};

export const updateTraveller = async (bookingId, travellerId, data) => {
  const t = await prisma.bookingTraveller.findFirst({
    where: { id: travellerId, bookingId },
    select: { id: true },
  });
  if (!t) throw new AppError('Traveller not found', 404);
  return prisma.bookingTraveller.update({ where: { id: travellerId }, data });
};

export const deleteTraveller = async (bookingId, travellerId) => {
  const t = await prisma.bookingTraveller.findFirst({
    where: { id: travellerId, bookingId },
    select: { id: true },
  });
  if (!t) throw new AppError('Traveller not found', 404);
  await prisma.bookingTraveller.delete({ where: { id: travellerId } });
  return true;
};

// ═══════════════════════════════════════════════
// DAYS
// ═══════════════════════════════════════════════

export const generateDaysFromItinerary = async (bookingId) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      travelStart: true,
      itinerary: {
        select: {
          days: {
            orderBy: { dayNumber: 'asc' },
            select: { dayNumber: true, title: true, description: true, activities: true },
          },
        },
      },
    },
  });
  if (!booking) throw new AppError('Booking not found', 404);
  if (!booking.itinerary?.days?.length) throw new AppError('No itinerary days found', 400);

  await prisma.$transaction(async (tx) => {
    await tx.bookingDay.deleteMany({ where: { bookingId } });
    await tx.bookingDay.createMany({
      data: booking.itinerary.days.map((day) => {
        let date = null;
        if (booking.travelStart) {
          date = new Date(booking.travelStart);
          date.setDate(date.getDate() + (day.dayNumber - 1));
        }
        return {
          bookingId,
          dayNumber: day.dayNumber,
          date,
          title: day.title ?? `Day ${day.dayNumber}`,
          description: day.description ?? day.activities ?? '',
          status: 'PENDING',
        };
      }),
    });
  });

  addLog(bookingId, 'Days generated from itinerary', 'MANUAL');
  return prisma.bookingDay.findMany({ where: { bookingId }, orderBy: { dayNumber: 'asc' } });
};

export const addDay = async (bookingId, data) => {
  await assertBookingExists(bookingId);
  const day = await prisma.bookingDay.create({
    data: {
      bookingId,
      dayNumber: data.dayNumber,
      title: data.title,
      description: data.description,
      date: data.date ? new Date(data.date) : null,
      status: 'PENDING',
    },
  });
  addLog(bookingId, `Day ${data.dayNumber} added: "${data.title}"`, 'MANUAL');
  return day;
};

export const updateDay = async (bookingId, dayId, data) => {
  const day = await prisma.bookingDay.findFirst({
    where: { id: dayId, bookingId },
    select: { id: true },
  });
  if (!day) throw new AppError('Day not found', 404);
  return prisma.bookingDay.update({ where: { id: dayId }, data });
};

export const deleteDay = async (bookingId, dayId) => {
  const day = await prisma.bookingDay.findFirst({
    where: { id: dayId, bookingId },
    select: { id: true, dayNumber: true },
  });
  if (!day) throw new AppError('Day not found', 404);
  await prisma.bookingDay.delete({ where: { id: dayId } });
  addLog(bookingId, `Day ${day.dayNumber} removed`, 'MANUAL');
  return true;
};

// ═══════════════════════════════════════════════
// PAYMENTS  —  atomic $transaction + UnifiedPayment sync
// ═══════════════════════════════════════════════

export const getPayments = async (bookingId) => {
  const [booking, payments] = await Promise.all([
    prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        totalAmount: true,
        advancePaid: true,
        paymentStatus: true,
        adults: true,
        children: true,
        pricePerAdult: true,
        pricePerChild: true,
      },
    }),
    prisma.bookingPayment.findMany({ where: { bookingId }, orderBy: { paidAt: 'desc' } }),
  ]);
  if (!booking) throw new AppError('Booking not found', 404);

  const totalAmount = booking.totalAmount ?? 0;
  const totalPaid = booking.advancePaid ?? 0;
  const dueAmount = Math.max(0, totalAmount - totalPaid);

  return {
    summary: {
      totalAmount,
      totalPaid,
      dueAmount,
      paymentStatus: booking.paymentStatus,
      adults: booking.adults ?? 0,
      children: booking.children ?? 0,
      pricePerAdult: booking.pricePerAdult ?? null,
      pricePerChild: booking.pricePerChild ?? null,
      breakdown: booking.pricePerAdult
        ? [
            ...(booking.adults
              ? [
                  {
                    label: `${booking.adults} Adult${booking.adults > 1 ? 's' : ''}`,
                    unitPrice: booking.pricePerAdult,
                    qty: booking.adults,
                    total: booking.pricePerAdult * booking.adults,
                  },
                ]
              : []),
            ...(booking.children && booking.pricePerChild
              ? [
                  {
                    label: `${booking.children} Child${booking.children > 1 ? 'ren' : ''}`,
                    unitPrice: booking.pricePerChild,
                    qty: booking.children,
                    total: booking.pricePerChild * booking.children,
                  },
                ]
              : []),
          ]
        : [],
    },
    payments,
  };
};

/**
 * addPayment  —  single atomic $transaction
 *
 * Step 1: Create BookingPayment
 * Step 2: Aggregate total paid → update booking.advancePaid + paymentStatus
 * Step 3: Create UnifiedPayment ledger entry (INCOMING, source=BOOKING)
 *
 * All succeed or all roll back — zero partial state.
 * The old non-blocking createFromBookingPayment import is removed;
 * everything now lives inside the transaction.
 */
export const addPayment = async (bookingId, data, createdById = null) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, totalAmount: true, customerId: true },
  });
  if (!booking) throw new AppError('Booking not found', 404);

  const paidAt = data.paidAt ? new Date(data.paidAt) : new Date();

  const payment = await prisma.$transaction(async (tx) => {
    // 1. Create BookingPayment
    const payment = await tx.bookingPayment.create({
      data: { ...data, bookingId, paidAt },
    });

    // 2. Aggregate (inside tx for consistency)
    const agg = await tx.bookingPayment.aggregate({
      where: { bookingId },
      _sum: { amount: true },
    });
    const totalPaid = agg._sum.amount ?? 0;
    const totalAmount = booking.totalAmount ?? 0;

    // 3. Update booking financials
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        advancePaid: totalPaid,
        paymentStatus: calcPaymentStatus(totalAmount, totalPaid),
      },
    });

    // 4. Mirror to UnifiedPayment ledger
    await tx.unifiedPayment.create({
      data: {
        type: 'INCOMING',
        source: 'BOOKING',
        sourceId: payment.id,
        bookingId,
        customerId: booking.customerId,
        amount: data.amount,
        method: data.mode ?? 'CASH',
        status: 'PAID',
        note: data.note ?? null,
        paidAt,
        ...(createdById && { createdById }),
      },
    });

    return payment;
  });

  addLog(bookingId, `Payment recorded: ₹${data.amount} via ${data.mode}`, 'MANUAL');
  return payment;
};

export const deletePayment = async (bookingId, paymentId) => {
  const p = await prisma.bookingPayment.findFirst({
    where: { id: paymentId, bookingId },
    select: { id: true },
  });
  if (!p) throw new AppError('Payment not found', 404);

  await prisma.$transaction(async (tx) => {
    // Remove ledger mirror first (by sourceId)
    await tx.unifiedPayment.deleteMany({
      where: { source: 'BOOKING', sourceId: paymentId },
    });

    await tx.bookingPayment.delete({ where: { id: paymentId } });

    const [bookingData, agg] = await Promise.all([
      tx.booking.findUnique({ where: { id: bookingId }, select: { totalAmount: true } }),
      tx.bookingPayment.aggregate({ where: { bookingId }, _sum: { amount: true } }),
    ]);

    const totalPaid = agg._sum.amount ?? 0;
    const totalAmount = bookingData?.totalAmount ?? 0;

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        advancePaid: totalPaid,
        paymentStatus: calcPaymentStatus(totalAmount, totalPaid),
      },
    });
  });

  return true;
};

// ═══════════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════════

export const getLogs = async (bookingId) =>
  prisma.bookingLog.findMany({ where: { bookingId }, orderBy: { createdAt: 'desc' } });

export const addManualLog = async (bookingId, message) => {
  const existing = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Booking not found', 404);
  return prisma.bookingLog.create({ data: { bookingId, message, type: 'MANUAL' } });
};

// ═══════════════════════════════════════════════
// VENDOR HELPERS  —  NEW
// ═══════════════════════════════════════════════

/**
 * getVendorsByType  —  for frontend dropdowns
 * Returns vendors filtered by type, preferred ones first, blacklisted excluded.
 * typeFilter: 'HOTEL' | 'AIRLINE' | 'TRANSPORT' | 'TOUR_OPERATOR' | etc.
 */
export const getVendorsByType = async (typeFilter) => {
  return prisma.vendor.findMany({
    where: {
      status: { not: 'BLACKLISTED' },
      OR: [
        { serviceType: typeFilter },
        { types: { has: typeFilter } },
      ],
    },
    select: {
      id: true,
      name: true,
      serviceType: true,
      types: true,
      phone: true,
      email: true,
      city: true,
      isPreferred: true,
    },
    orderBy: [{ isPreferred: 'desc' }, { name: 'asc' }],
  });
};

/**
 * getVendorUsage  —  vendor detail page data
 *
 * Returns all bookings where vendor is linked to any service,
 * plus aggregate revenue and per-service breakdown.
 * Zero N+1: 3 parallel indexed queries + 1 aggregate + 1 paginated fetch.
 */
export const getVendorUsage = async (vendorId, { page, limit } = {}) => {
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const [vendor, hotelRows, flightRows, transportRows] = await Promise.all([
    prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, name: true, serviceType: true, types: true, city: true, phone: true },
    }),
    prisma.hotelBooking.findMany({ where: { vendorId }, select: { bookingId: true } }),
    prisma.flightBooking.findMany({ where: { vendorId }, select: { bookingId: true } }),
    prisma.transportBooking.findMany({ where: { vendorId }, select: { bookingId: true } }),
  ]);

  if (!vendor) throw new AppError('Vendor not found', 404);

  const bookingIds = [
    ...new Set([
      ...hotelRows.map((r) => r.bookingId),
      ...flightRows.map((r) => r.bookingId),
      ...transportRows.map((r) => r.bookingId),
    ]),
  ];

  const [bookings, revenueAgg] = await Promise.all([
    prisma.booking.findMany({
      where: { id: { in: bookingIds } },
      select: {
        id: true,
        status: true,
        tripStatus: true,
        totalAmount: true,
        travelStart: true,
        travelEnd: true,
        createdAt: true,
        customer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.booking.aggregate({
      where: { id: { in: bookingIds } },
      _sum: { totalAmount: true },
      _count: { id: true },
    }),
  ]);

  return {
    vendor,
    totalBookings: revenueAgg._count.id,
    totalRevenue: revenueAgg._sum.totalAmount ?? 0,
    serviceBreakdown: {
      hotels: hotelRows.length,
      flights: flightRows.length,
      transports: transportRows.length,
    },
    bookings,
    pagination: buildPaginationMeta(revenueAgg._count.id, pageNum, limitNum),
  };
};

// ═══════════════════════════════════════════════
// ITINERARY → BOOKING CONVERSION
// ═══════════════════════════════════════════════

export const convertItineraryToBooking = async (itineraryId) => {
  const itinerary = await prisma.itinerary.findUnique({
    where: { id: itineraryId },
    select: {
      id: true,
      title: true,
      customerId: true,
      startDate: true,
      endDate: true,
      totalDays: true,
      durationLabel: true,
      numberOfTravelers: true,
      days: {
        orderBy: { dayNumber: 'asc' },
        select: { dayNumber: true, title: true, description: true, activities: true },
      },
    },
  });
  if (!itinerary) throw new AppError('Itinerary not found', 404);
  if (!itinerary.customerId) throw new AppError('Itinerary has no customer linked', 400);

  const nights = itinerary.totalDays ? itinerary.totalDays - 1 : 0;

  const booking = await prisma.booking.create({
    data: {
      customerId: itinerary.customerId,
      itineraryId,
      status: 'DRAFT',
      travelStart: itinerary.startDate,
      travelEnd: itinerary.endDate,
      totalDays: itinerary.totalDays,
      totalNights: nights,
      adults: itinerary.numberOfTravelers ?? 1,
      tourDays: itinerary.durationLabel ?? '',
      tripStatus: calcTripStatus(itinerary.startDate, itinerary.endDate),
      tasks: { create: DEFAULT_TASKS.map((title) => ({ title, isDefault: true })) },
      days: {
        create: itinerary.days.map((day) => {
          let date = null;
          if (itinerary.startDate) {
            date = new Date(itinerary.startDate);
            date.setDate(date.getDate() + (day.dayNumber - 1));
          }
          return {
            dayNumber: day.dayNumber,
            date,
            title: day.title ?? `Day ${day.dayNumber}`,
            description: day.description ?? day.activities ?? '',
            status: 'PENDING',
          };
        }),
      },
    },
    include: bookingInclude,
  });

  addLog(booking.id, `Booking created from itinerary: "${itinerary.title}"`);
  return booking;
};

// ═══════════════════════════════════════════════
// CRON  —  updateAllTripStatuses (optimised)
// ═══════════════════════════════════════════════

/**
 * Original: N individual .update() calls (one per booking).
 * Upgraded: 3 updateMany() calls grouped by status bucket — O(1) DB round-trips.
 */
export const updateAllTripStatuses = async () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const base = { status: { notIn: ['CANCELLED'] } };

  const [toOngoing, toCompleted, toUpcoming] = await Promise.all([
    // UPCOMING/COMPLETED → ONGOING  (started but not yet ended)
    prisma.booking.updateMany({
      where: {
        ...base,
        tripStatus: { not: 'ONGOING' },
        travelStart: { lte: now },
        OR: [{ travelEnd: null }, { travelEnd: { gte: today } }],
      },
      data: { tripStatus: 'ONGOING' },
    }),
    // ONGOING → COMPLETED  (end date passed)
    prisma.booking.updateMany({
      where: {
        ...base,
        tripStatus: { not: 'COMPLETED' },
        travelEnd: { lt: today },
      },
      data: { tripStatus: 'COMPLETED' },
    }),
    // Any → UPCOMING  (start date still in the future — safety net)
    prisma.booking.updateMany({
      where: {
        ...base,
        tripStatus: { not: 'UPCOMING' },
        travelStart: { gte: tomorrow },
      },
      data: { tripStatus: 'UPCOMING' },
    }),
  ]);

  return toOngoing.count + toCompleted.count + toUpcoming.count;
};

// ═══════════════════════════════════════════════
// WHATSAPP
// ═══════════════════════════════════════════════

export const getWhatsappMessage = async (bookingId, type = 'TRIP_START') => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      travelStart: true,
      travelEnd: true,
      startDetails: true,
      endDetails: true,
      totalDays: true,
      customer: { select: { name: true, phone: true } },
      transportBookings: {
        take: 1,
        select: { vehicleType: true, driverName: true, driverPhone: true },
      },
      hotelBookings: {
        take: 1,
        orderBy: { checkIn: 'asc' },
        select: { hotelName: true, city: true },
      },
      days: {
        orderBy: { dayNumber: 'asc' },
        select: { dayNumber: true, title: true, description: true },
      },
    },
  });
  if (!booking) throw new AppError('Booking not found', 404);

  const customer = booking.customer;
  const transport = booking.transportBookings?.[0];
  const hotel = booking.hotelBookings?.[0];
  const days = booking.days ?? [];
  const customerName = customer?.name ?? 'Valued Guest';
  const phone = customer?.phone ?? '';
  const startDate = booking.travelStart
    ? new Date(booking.travelStart).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '';

  let message = '';

  if (type === 'TRIP_START') {
    const day1 = days.find((d) => d.dayNumber === 1);
    message = `🙏 *Namaste ${customerName} Ji!*

Your trip starts tomorrow! Here's a quick summary:

📅 *Travel Date:* ${startDate}
${booking.startDetails ? `📍 *Pickup:* ${booking.startDetails}` : ''}
${hotel ? `🏨 *Hotel:* ${hotel.hotelName}, ${hotel.city}` : ''}
${transport ? `🚗 *Vehicle:* ${transport.vehicleType}${transport.driverName ? `\n👤 *Driver:* ${transport.driverName} — ${transport.driverPhone ?? ''}` : ''}` : ''}
${day1 ? `\n📋 *Day 1 Plan:*\n${day1.description ?? day1.title ?? ''}` : ''}

Have a wonderful journey! 🌟
_— Your Travel Team_`;
  }

  if (type === 'DAILY') {
    const today = new Date();
    const start = booking.travelStart ? new Date(booking.travelStart) : null;
    const dayNum = start ? differenceInDays(today, start) + 1 : 1;
    const dayEntry = days.find((d) => d.dayNumber === dayNum);
    message = `🌅 *Good Morning, ${customerName} Ji!*

*Day ${dayNum}* of your trip!

${dayEntry ? `📋 *Today's Plan:*\n${dayEntry.description ?? dayEntry.title ?? 'Enjoy your day!'}` : 'Enjoy your day!'}

${transport ? `🚗 *Your Driver:* ${transport.driverName ?? ''} — ${transport.driverPhone ?? ''}` : ''}

Have a great day ahead! ✨`;
  }

  if (type === 'FINAL_DAY') {
    message = `🌟 *Last Day, ${customerName} Ji!*

Hope you had an amazing trip! 

📅 *Check-out:* ${booking.endDetails ?? 'As per your booking'}

We're so glad you traveled with us. Safe journey home! 🏠

_Thank you for choosing us!_ 🙏`;
  }

  if (type === 'POST_TRIP') {
    message = `💌 *Hello ${customerName} Ji!*

Hope you're back home safe and sound after your trip! 🏠

We'd love to hear about your experience. Please share your feedback! 🌟

📱 Reply to this message or call us anytime.

_We look forward to planning your next adventure!_ ✈️🌍`;
  }

  return {
    message,
    phone,
    whatsappUrl: `https://wa.me/91${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`,
  };
};

// ═══════════════════════════════════════════════
// EMAIL
// ═══════════════════════════════════════════════

let _transporter = null;
const getTransporter = () => {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  }
  return _transporter;
};

export const sendBookingEmail = async (bookingId, { to, subject, body }) => {
  const booking = await getBookingById(bookingId);
  const { generateBookingVoucherPdf } = await import('../pdf/pdf.service.js');
  const pdfBuffer = await generateBookingVoucherPdf(booking);

  const mailOptions = {
    from: `"Travel CRM" <${process.env.EMAIL_USER}>`,
    to: to || booking.customer?.email,
    subject: subject || `Booking Confirmation — ${booking.customer?.name}`,
    html: body || buildEmailBody(booking),
    attachments: [
      {
        filename: `booking-voucher-${booking.id.slice(-8).toUpperCase()}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  };

  await getTransporter().sendMail(mailOptions);
  addLog(bookingId, `Voucher email sent to ${mailOptions.to}`, 'MANUAL');
  return { success: true, sentTo: mailOptions.to };
};

function buildEmailBody(booking) {
  const customer = booking.customer ?? {};
  const hotels = booking.hotelBookings ?? [];
  const transport = booking.transportBookings?.[0];

  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
      <div style="background:#1a1a2e;padding:24px 32px;border-radius:12px 12px 0 0;">
        <h1 style="color:#fff;font-size:20px;margin:0;">Booking Confirmation</h1>
        <p style="color:#94a3b8;margin:6px 0 0;font-size:13px;">Your travel details are confirmed ✓</p>
      </div>
      <div style="background:#f8fafc;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;">
        <p style="font-size:15px;color:#374151;">Dear <strong>${customer.name ?? 'Valued Guest'}</strong>,</p>
        <p style="font-size:14px;color:#6b7280;line-height:1.6;">Your booking has been confirmed. Please find your travel voucher attached.</p>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin:20px 0;">
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <tr><td style="padding:7px 0;color:#6b7280;width:40%;">Booking Ref</td><td style="padding:7px 0;font-weight:600;font-family:monospace;">#${booking.id.slice(-8).toUpperCase()}</td></tr>
            <tr style="border-top:1px solid #f1f5f9;"><td style="padding:7px 0;color:#6b7280;">Customer</td><td style="padding:7px 0;font-weight:600;">${customer.name ?? '—'}</td></tr>
            ${booking.travelStart ? `<tr style="border-top:1px solid #f1f5f9;"><td style="padding:7px 0;color:#6b7280;">Travel Dates</td><td style="padding:7px 0;font-weight:600;">${new Date(booking.travelStart).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} → ${booking.travelEnd ? new Date(booking.travelEnd).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td></tr>` : ''}
            ${hotels[0] ? `<tr style="border-top:1px solid #f1f5f9;"><td style="padding:7px 0;color:#6b7280;">Hotel</td><td style="padding:7px 0;font-weight:600;">${hotels[0].hotelName}, ${hotels[0].city}</td></tr>` : ''}
            ${transport?.driverName ? `<tr style="border-top:1px solid #f1f5f9;"><td style="padding:7px 0;color:#6b7280;">Driver</td><td style="padding:7px 0;font-weight:600;">${transport.driverName} — ${transport.driverPhone ?? ''}</td></tr>` : ''}
            <tr style="border-top:1px solid #f1f5f9;"><td style="padding:7px 0;color:#6b7280;">Travelers</td><td style="padding:7px 0;font-weight:600;">${booking.adults ?? 0} Adults${booking.children ? ` + ${booking.children} Children` : ''}</td></tr>
          </table>
        </div>
        <p style="font-size:13px;color:#6b7280;">📎 <strong>Your booking voucher is attached as a PDF.</strong></p>
        <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center;">
          <p style="font-size:12px;color:#9ca3af;">Travel CRM · Have a wonderful journey! ✈️</p>
        </div>
      </div>
    </div>
  `;
}