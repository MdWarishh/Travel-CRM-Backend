import * as bookingService from './booking.service.js';
import {
  createBookingSchema,
  updateBookingSchema,
  addBookingItemSchema,
  hotelBookingSchema,
  flightBookingSchema,
  transportBookingSchema,
  addTaskSchema,
  addTravellerSchema,
  updateDaySchema,
  addPaymentSchema,
  addLogSchema,
  vendorTypeQuerySchema,
} from './booking.validation.js';
import { ApiResponse } from '../../utils/helpers.js';
import { z } from 'zod';

// ─── Booking CRUD ──────────────────────────────
export const getAllBookings = async (req, res) => {
  const result = await bookingService.getAllBookings(req.query, req.user);
  return ApiResponse.paginated(res, result.bookings, result.pagination);
};

export const getBookingById = async (req, res) => {
  const booking = await bookingService.getBookingById(req.params.id);
  return ApiResponse.success(res, booking);
};

export const createBooking = async (req, res) => {
  const data = createBookingSchema.parse(req.body);
  const booking = await bookingService.createBooking(data);
  return ApiResponse.created(res, booking, 'Booking created');
};

export const updateBooking = async (req, res) => {
  const data = updateBookingSchema.parse(req.body);
  const booking = await bookingService.updateBooking(req.params.id, data);
  return ApiResponse.success(res, booking, 'Booking updated');
};

export const updateBookingStatus = async (req, res) => {
  const { status } = z
    .object({
      status: z.enum([
        'DRAFT', 'PENDING', 'REQUESTED', 'CONFIRMED',
        'VOUCHER_SENT', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
      ]),
    })
    .parse(req.body);
  const booking = await bookingService.updateBookingStatus(req.params.id, status);
  return ApiResponse.success(res, booking, 'Status updated');
};

export const deleteBooking = async (req, res) => {
  await bookingService.deleteBooking(req.params.id);
  return ApiResponse.success(res, null, 'Booking deleted');
};

// ─── Generic items ─────────────────────────────
export const addBookingItem = async (req, res) => {
  const data = addBookingItemSchema.parse(req.body);
  const item = await bookingService.addBookingItem(req.params.id, data);
  return ApiResponse.created(res, item, 'Item added');
};

export const updateBookingItem = async (req, res) => {
  const data = addBookingItemSchema.partial().parse(req.body);
  const item = await bookingService.updateBookingItem(req.params.id, req.params.itemId, data);
  return ApiResponse.success(res, item, 'Item updated');
};

export const deleteBookingItem = async (req, res) => {
  await bookingService.deleteBookingItem(req.params.id, req.params.itemId);
  return ApiResponse.success(res, null, 'Item deleted');
};

// ─── Hotels ────────────────────────────────────
export const addHotelBooking = async (req, res) => {
  const data = hotelBookingSchema.parse(req.body);
  const item = await bookingService.addHotelBooking(req.params.id, data);
  return ApiResponse.created(res, item, 'Hotel booking added');
};

export const updateHotelBooking = async (req, res) => {
  const data = hotelBookingSchema.partial().parse(req.body);
  const item = await bookingService.updateHotelBooking(req.params.id, req.params.hotelId, data);
  return ApiResponse.success(res, item, 'Hotel booking updated');
};

export const deleteHotelBooking = async (req, res) => {
  await bookingService.deleteHotelBooking(req.params.id, req.params.hotelId);
  return ApiResponse.success(res, null, 'Hotel booking deleted');
};

// ─── Flights ───────────────────────────────────
export const addFlightBooking = async (req, res) => {
  const data = flightBookingSchema.parse(req.body);
  const item = await bookingService.addFlightBooking(req.params.id, data);
  return ApiResponse.created(res, item, 'Flight booking added');
};

export const updateFlightBooking = async (req, res) => {
  const data = flightBookingSchema.partial().parse(req.body);
  const item = await bookingService.updateFlightBooking(req.params.id, req.params.flightId, data);
  return ApiResponse.success(res, item, 'Flight booking updated');
};

export const deleteFlightBooking = async (req, res) => {
  await bookingService.deleteFlightBooking(req.params.id, req.params.flightId);
  return ApiResponse.success(res, null, 'Flight booking deleted');
};

// ─── Transport ─────────────────────────────────
export const addTransportBooking = async (req, res) => {
  const data = transportBookingSchema.parse(req.body);
  const item = await bookingService.addTransportBooking(req.params.id, data);
  return ApiResponse.created(res, item, 'Transport booking added');
};

export const updateTransportBooking = async (req, res) => {
  const data = transportBookingSchema.partial().parse(req.body);
  const item = await bookingService.updateTransportBooking(
    req.params.id,
    req.params.transportId,
    data,
  );
  return ApiResponse.success(res, item, 'Transport booking updated');
};

export const deleteTransportBooking = async (req, res) => {
  await bookingService.deleteTransportBooking(req.params.id, req.params.transportId);
  return ApiResponse.success(res, null, 'Transport booking deleted');
};

// ─── Tasks ─────────────────────────────────────
export const getTasks = async (req, res) => {
  const tasks = await bookingService.getTasks(req.params.id);
  return ApiResponse.success(res, tasks);
};

export const addTask = async (req, res) => {
  const { title } = addTaskSchema.parse(req.body);
  const task = await bookingService.addTask(req.params.id, title);
  return ApiResponse.created(res, task, 'Task added');
};

export const toggleTask = async (req, res) => {
  const task = await bookingService.toggleTask(req.params.id, req.params.taskId);
  return ApiResponse.success(res, task, 'Task updated');
};

export const deleteTask = async (req, res) => {
  await bookingService.deleteTask(req.params.id, req.params.taskId);
  return ApiResponse.success(res, null, 'Task deleted');
};

// ─── Travellers ────────────────────────────────
export const getTravellers = async (req, res) => {
  const travellers = await bookingService.getTravellers(req.params.id);
  return ApiResponse.success(res, travellers);
};

export const addTraveller = async (req, res) => {
  const data = addTravellerSchema.parse(req.body);
  const traveller = await bookingService.addTraveller(req.params.id, data);
  return ApiResponse.created(res, traveller, 'Traveller added');
};

export const updateTraveller = async (req, res) => {
  const data = addTravellerSchema.partial().parse(req.body);
  const traveller = await bookingService.updateTraveller(
    req.params.id,
    req.params.travellerId,
    data,
  );
  return ApiResponse.success(res, traveller, 'Traveller updated');
};

export const deleteTraveller = async (req, res) => {
  await bookingService.deleteTraveller(req.params.id, req.params.travellerId);
  return ApiResponse.success(res, null, 'Traveller deleted');
};

// ─── Days ──────────────────────────────────────
export const generateDays = async (req, res) => {
  const days = await bookingService.generateDaysFromItinerary(req.params.id);
  return ApiResponse.success(res, days, 'Days generated');
};

export const addDay = async (req, res) => {
  const data = z
    .object({
      dayNumber: z.number().int().min(1),
      title: z.string().min(1, 'Title required'),
      description: z.string().optional(),
      date: z.string().optional(),
    })
    .parse(req.body);
  const day = await bookingService.addDay(req.params.id, data);
  return ApiResponse.created(res, day, 'Day added');
};

export const updateDay = async (req, res) => {
  const data = updateDaySchema.parse(req.body);
  const day = await bookingService.updateDay(req.params.id, req.params.dayId, data);
  return ApiResponse.success(res, day, 'Day updated');
};

export const deleteDay = async (req, res) => {
  await bookingService.deleteDay(req.params.id, req.params.dayId);
  return ApiResponse.success(res, null, 'Day deleted');
};

// ─── Payments ──────────────────────────────────
export const getPayments = async (req, res) => {
  const result = await bookingService.getPayments(req.params.id);
  return ApiResponse.success(res, result);
};

// Pass req.user.id so the ledger entry has a createdById audit trail
export const addPayment = async (req, res) => {
  const data = addPaymentSchema.parse(req.body);
  const payment = await bookingService.addPayment(
    req.params.id,
    data,
    req.user?.id ?? null,
  );
  return ApiResponse.created(res, payment, 'Payment recorded');
};

export const deletePayment = async (req, res) => {
  await bookingService.deletePayment(req.params.id, req.params.paymentId);
  return ApiResponse.success(res, null, 'Payment deleted');
};

// ─── Logs ──────────────────────────────────────
export const getLogs = async (req, res) => {
  const logs = await bookingService.getLogs(req.params.id);
  return ApiResponse.success(res, logs);
};

export const addLog = async (req, res) => {
  const { message } = addLogSchema.parse(req.body);
  const log = await bookingService.addManualLog(req.params.id, message);
  return ApiResponse.created(res, log, 'Log added');
};

// ─── WhatsApp ──────────────────────────────────
export const getWhatsappMessage = async (req, res) => {
  const { type } = req.query;
  const result = await bookingService.getWhatsappMessage(req.params.id, type ?? 'TRIP_START');
  return ApiResponse.success(res, result);
};

// ─── Convert itinerary ─────────────────────────
export const convertItinerary = async (req, res) => {
  const { itineraryId } = z.object({ itineraryId: z.string().uuid() }).parse(req.body);
  const booking = await bookingService.convertItineraryToBooking(itineraryId);
  return ApiResponse.created(res, booking, 'Booking created from itinerary');
};

// ─── Email send ────────────────────────────────
export const sendBookingEmail = async (req, res) => {
  const data = z
    .object({
      to: z.string().email().optional(),
      subject: z.string().optional(),
      body: z.string().optional(),
    })
    .parse(req.body);
  const result = await bookingService.sendBookingEmail(req.params.id, data);
  return ApiResponse.success(res, result, `Email sent to ${result.sentTo}`);
};

// ─── Vendor dropdown  —  NEW ───────────────────
// GET /bookings/vendors?type=HOTEL
// Returns vendors filtered by service type for per-service dropdowns on the frontend.
export const getVendorsByType = async (req, res) => {
  const { type } = vendorTypeQuerySchema.parse(req.query);
  const vendors = await bookingService.getVendorsByType(type);
  return ApiResponse.success(res, vendors);
};

// ─── Vendor usage report  —  NEW ──────────────
// GET /bookings/vendors/:vendorId/usage
// Shows all bookings where vendor is linked + revenue aggregation.
// Used on the Vendor detail page.
export const getVendorUsage = async (req, res) => {
  const result = await bookingService.getVendorUsage(req.params.vendorId, req.query);
  return ApiResponse.success(res, result);
};