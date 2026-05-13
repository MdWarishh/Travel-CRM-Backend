import * as paymentService from './payment.service.js';
import {
  createPaymentSchema,
  updatePaymentSchema,
  createInvoiceSchema,
  createBookingInvoiceSchema,
  exportPaymentsSchema,
  sendReminderSchema,
  sendConfirmationSchema,
  sendInvoiceSchema,
} from './payment.validation.js';
import { ApiResponse } from '../../utils/helpers.js';

// ─────────────────────────────────────────────
// CSV/EXCEL HELPER (no extra dependency — pure CSV)
// ─────────────────────────────────────────────

const rowsToCsv = (rows) => {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ];
  return lines.join('\n');
};

// ─────────────────────────────────────────────
// CONTROLLER
// ─────────────────────────────────────────────

const paymentController = {

  // ── GET ALL PAYMENTS ──────────────────────
  getAllPayments: async (req, res) => {
    const result = await paymentService.getAllPayments(req.query, req.user);
    return res.status(200).json({
      success: true,
      data: result.payments,
      pagination: result.pagination,
      summary: result.summary,
    });
  },

  // ── GET SINGLE PAYMENT ────────────────────
  getPaymentById: async (req, res) => {
    const payment = await paymentService.getPaymentById(req.params.id);
    return ApiResponse.success(res, payment);
  },

  // ── CREATE PAYMENT ────────────────────────
  createPayment: async (req, res) => {
    const data = createPaymentSchema.parse(req.body);
    const payment = await paymentService.createPayment(data, req.user?.id);
    return ApiResponse.created(res, payment, 'Payment recorded');
  },

  // ── UPDATE PAYMENT ────────────────────────
  updatePayment: async (req, res) => {
    const data = updatePaymentSchema.parse(req.body);
    const payment = await paymentService.updatePayment(req.params.id, data, req.user?.id);
    return ApiResponse.success(res, payment, 'Payment updated');
  },

  // ── DELETE PAYMENT ────────────────────────
  deletePayment: async (req, res) => {
    await paymentService.deletePayment(req.params.id, req.user?.id);
    return ApiResponse.success(res, null, 'Payment deleted');
  },

  // ─────────────────────────────────────────
  // BOOKING PAYMENT SUMMARY
  // ─────────────────────────────────────────

  getBookingPaymentSummary: async (req, res) => {
    const result = await paymentService.getBookingPaymentSummary(req.params.bookingId);
    return ApiResponse.success(res, result);
  },

  // ─────────────────────────────────────────
  // CUSTOMER PAYMENT SUMMARY
  // ─────────────────────────────────────────

  getCustomerPaymentSummary: async (req, res) => {
    const result = await paymentService.getCustomerPaymentSummary(req.params.customerId);
    return ApiResponse.success(res, result);
  },

  // ─────────────────────────────────────────
  // RECEIPT (PAYMENT SLIP)
  // ─────────────────────────────────────────

  getPaymentReceipt: async (req, res) => {
    const receipt = await paymentService.getPaymentReceipt(req.params.id);
    return ApiResponse.success(res, receipt);
  },

  // ─────────────────────────────────────────
  // INVOICES
  // ─────────────────────────────────────────

  createInvoice: async (req, res) => {
    const data = createInvoiceSchema.parse(req.body);
    const invoice = await paymentService.createPaymentInvoice(data);
    return ApiResponse.created(res, invoice, 'Invoice generated');
  },

  createBookingInvoice: async (req, res) => {
    const data = createBookingInvoiceSchema.parse(req.body);
    const invoice = await paymentService.createBookingInvoice(data);
    return ApiResponse.created(res, invoice, 'Booking invoice generated');
  },

  getInvoiceById: async (req, res) => {
    const invoice = await paymentService.getInvoiceById(req.params.id);
    return ApiResponse.success(res, invoice);
  },

  getInvoicesByBooking: async (req, res) => {
    const invoices = await paymentService.getInvoicesByBooking(req.params.bookingId);
    return ApiResponse.success(res, invoices);
  },

  // ─────────────────────────────────────────
  // EXPORT
  // ─────────────────────────────────────────

  exportPayments: async (req, res) => {
    const filters = exportPaymentsSchema.parse(req.query);
    const rows = await paymentService.exportPayments(filters, req.user);

    if (filters.format === 'excel') {
      // Return JSON rows — frontend (or a separate xlsx service) handles Excel generation
      // If you have exceljs on server, you can pipe it here
      return res.status(200).json({
        success: true,
        data: rows,
        count: rows.length,
        hint: 'Use this JSON to generate Excel on the client or pipe to exceljs on server.',
      });
    }

    // CSV response
    const csv = rowsToCsv(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payments_export_${Date.now()}.csv"`);
    return res.status(200).send(csv);
  },

  // ─────────────────────────────────────────
  // REMINDERS & CONFIRMATIONS
  // ─────────────────────────────────────────

  /**
   * GET — preview the reminder message (before sending)
   */
  previewReminder: async (req, res) => {
    const { bookingId } = req.params;
    const { message } = req.query;
    const result = await paymentService.buildReminderMessage(bookingId, message);
    return ApiResponse.success(res, result);
  },

  /**
   * POST — actually send the reminder
   */
  sendPaymentReminder: async (req, res) => {
    const data = sendReminderSchema.parse(req.body);
    const result = await paymentService.sendPaymentReminder(data, req.user?.id);
    return ApiResponse.success(res, result, 'Payment reminder sent');
  },

  /**
   * GET — preview confirmation message (before sending)
   */
  previewConfirmation: async (req, res) => {
    const { paymentId } = req.params;
    const { message } = req.query;
    const result = await paymentService.buildConfirmationMessage(paymentId, message);
    return ApiResponse.success(res, result);
  },

  /**
   * POST — send payment confirmation
   */
  sendPaymentConfirmation: async (req, res) => {
    const data = sendConfirmationSchema.parse(req.body);
    const result = await paymentService.sendPaymentConfirmation(data, req.user?.id);
    return ApiResponse.success(res, result, 'Payment confirmation sent');
  },

  /**
   * POST — send invoice via WhatsApp/Email
   */
  sendInvoice: async (req, res) => {
    const data = sendInvoiceSchema.parse(req.body);
    const result = await paymentService.sendInvoice(data, req.user?.id);
    return ApiResponse.success(res, result, 'Invoice sent');
  },

  // ─────────────────────────────────────────
  // ACTIVITY LOG
  // ─────────────────────────────────────────

  getPaymentActivityLog: async (req, res) => {
    const logs = await paymentService.getPaymentActivityLog(req.params.id);
    return ApiResponse.success(res, logs);
  },

};

export default paymentController;