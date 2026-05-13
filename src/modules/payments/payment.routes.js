import { Router } from 'express';
import controller from './payment.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

// 🔐 Auth on all routes
router.use(authenticate);

// ─────────────────────────────────────────────
// 💳 CORE PAYMENT ROUTES
// ─────────────────────────────────────────────

router
  .route('/')
  .get(controller.getAllPayments)        // GET  /payments?status&mode&search&sort&startDate&endDate
  .post(controller.createPayment);       // POST /payments

router
  .route('/:id')
  .get(controller.getPaymentById)        // GET  /payments/:id
  .put(controller.updatePayment)         // PUT  /payments/:id
  .delete(authorize('ADMIN'), controller.deletePayment); // DELETE /payments/:id (ADMIN only)

// ─────────────────────────────────────────────
// 🧾 RECEIPT (PAYMENT SLIP)
// ─────────────────────────────────────────────

router.get('/:id/receipt', controller.getPaymentReceipt);
// GET /payments/:id/receipt — returns receipt data for PDF generation on frontend

// ─────────────────────────────────────────────
// 📋 ACTIVITY LOG
// ─────────────────────────────────────────────

router.get('/:id/activity', controller.getPaymentActivityLog);
// GET /payments/:id/activity — returns all activity logs for this payment

// ─────────────────────────────────────────────
// 📦 EXPORT
// ─────────────────────────────────────────────

router.get('/export/download', controller.exportPayments);
// GET /payments/export/download?format=csv&status&startDate&endDate&mode

// ─────────────────────────────────────────────
// 🧾 INVOICE ROUTES
// ─────────────────────────────────────────────

router
  .route('/invoices')
  .post(controller.createInvoice);       // POST /payments/invoices  (payment-level invoice)

router
  .route('/invoices/booking')
  .post(controller.createBookingInvoice); // POST /payments/invoices/booking  (full booking invoice)

router
  .route('/invoices/:id')
  .get(controller.getInvoiceById);       // GET  /payments/invoices/:id

// ─────────────────────────────────────────────
// 📁 BOOKING — PAYMENT SUMMARY & INVOICES
// ─────────────────────────────────────────────

router.get('/booking/:bookingId/summary', controller.getBookingPaymentSummary);
// GET /payments/booking/:bookingId/summary — totalPaid, remaining, all payments

router.get('/booking/:bookingId/invoices', controller.getInvoicesByBooking);
// GET /payments/booking/:bookingId/invoices — all invoices for a booking

// ─────────────────────────────────────────────
// 👤 CUSTOMER — PAYMENT SUMMARY
// ─────────────────────────────────────────────

router.get('/customer/:customerId/summary', controller.getCustomerPaymentSummary);
// GET /payments/customer/:customerId/summary — totalSpend, pendingAmount, history

// ─────────────────────────────────────────────
// 🔔 REMINDERS & CONFIRMATIONS
// ─────────────────────────────────────────────

// Reminder (due payment)
router.get('/reminder/:bookingId/preview', controller.previewReminder);
// GET /payments/reminder/:bookingId/preview?message=... — preview before sending

router.post('/reminder/send', controller.sendPaymentReminder);
// POST /payments/reminder/send  { bookingId, channel, message?, attachInvoice?, attachReceipt? }

// Confirmation (after payment)
router.get('/confirmation/:paymentId/preview', controller.previewConfirmation);
// GET /payments/confirmation/:paymentId/preview?message=... — preview before sending

router.post('/confirmation/send', controller.sendPaymentConfirmation);
// POST /payments/confirmation/send  { paymentId, channel, message?, attachReceipt? }

// Invoice send
router.post('/invoices/send', controller.sendInvoice);
// POST /payments/invoices/send  { invoiceId, channel, message? }

export default router;