import { Router } from 'express';
import * as c from './booking.controller.js';
import * as bookingService from './booking.service.js';
import { generateBookingVoucherPdf } from '../pdf/pdf.service.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();
router.use(authenticate);

// ─── Booking CRUD ──────────────────────────────
router.get('/', c.getAllBookings);
router.post('/', c.createBooking);
router.post('/convert-itinerary', c.convertItinerary);

// ─── Vendor routes — MUST be before /:id ───────
// ⚠️ These must come before router.get('/:id') else Express
//    treats "vendors" as a bookingId param → 404
router.get('/vendors', c.getVendorsByType);               // GET /bookings/vendors?type=HOTEL
router.get('/vendors/:vendorId/usage', c.getVendorUsage); // GET /bookings/vendors/:vendorId/usage

// ─── Single booking ────────────────────────────
router.get('/:id', c.getBookingById);
router.put('/:id', c.updateBooking);
router.patch('/:id/status', c.updateBookingStatus);
router.delete('/:id', authorize('ADMIN', 'MANAGER'), c.deleteBooking);

// ─── Generic items ─────────────────────────────
router.post('/:id/items', c.addBookingItem);
router.put('/:id/items/:itemId', c.updateBookingItem);
router.delete('/:id/items/:itemId', c.deleteBookingItem);

// ─── Hotels ────────────────────────────────────
router.post('/:id/hotels', c.addHotelBooking);
router.put('/:id/hotels/:hotelId', c.updateHotelBooking);
router.delete('/:id/hotels/:hotelId', c.deleteHotelBooking);

// ─── Flights ───────────────────────────────────
router.post('/:id/flights', c.addFlightBooking);
router.put('/:id/flights/:flightId', c.updateFlightBooking);
router.delete('/:id/flights/:flightId', c.deleteFlightBooking);

// ─── Transport ─────────────────────────────────
router.post('/:id/transports', c.addTransportBooking);
router.put('/:id/transports/:transportId', c.updateTransportBooking);
router.delete('/:id/transports/:transportId', c.deleteTransportBooking);

// ─── Tasks ─────────────────────────────────────
router.get('/:id/tasks', c.getTasks);
router.post('/:id/tasks', c.addTask);
router.patch('/:id/tasks/:taskId/toggle', c.toggleTask);
router.delete('/:id/tasks/:taskId', c.deleteTask);

// ─── Travellers ────────────────────────────────
router.get('/:id/travellers', c.getTravellers);
router.post('/:id/travellers', c.addTraveller);
router.put('/:id/travellers/:travellerId', c.updateTraveller);
router.delete('/:id/travellers/:travellerId', c.deleteTraveller);

// ─── Days ──────────────────────────────────────
router.post('/:id/days/generate', c.generateDays);
router.post('/:id/days', c.addDay);
router.patch('/:id/days/:dayId', c.updateDay);
router.delete('/:id/days/:dayId', c.deleteDay);

// ─── Payments ──────────────────────────────────
router.get('/:id/payments', c.getPayments);
router.post('/:id/payments', c.addPayment);
router.delete('/:id/payments/:paymentId', c.deletePayment);

// ─── Logs ──────────────────────────────────────
router.get('/:id/logs', c.getLogs);
router.post('/:id/logs', c.addLog);

// ─── WhatsApp message generator ────────────────
router.get('/:id/whatsapp', c.getWhatsappMessage);

// ─── Email send ────────────────────────────────
router.post('/:id/send-email', c.sendBookingEmail);

// ─── PDF Voucher download ──────────────────────
router.get('/:id/voucher', async (req, res) => {
  const booking = await bookingService.getBookingById(req.params.id);
  const pdfBuffer = await generateBookingVoucherPdf(booking);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="voucher-${req.params.id.slice(-8)}.pdf"`,
  });
  res.send(pdfBuffer);
});

export default router;