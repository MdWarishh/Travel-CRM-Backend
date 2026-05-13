import * as service from './unified_payment.service.js';
import {
  createUnifiedPaymentSchema,
  updateUnifiedPaymentSchema,
  getUnifiedPaymentsSchema,
  exportUnifiedPaymentsSchema,
} from './unified_payment.validation.js';
import { ApiResponse } from '../../utils/helpers.js';

// ─────────────────────────────────────────────
// CSV helper
// ─────────────────────────────────────────────

const rowsToCsv = (rows) => {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape  = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  return [
    headers.map(escape).join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\n');
};

// ─────────────────────────────────────────────
// CONTROLLER
// ─────────────────────────────────────────────

const unifiedPaymentController = {

  // ── GET ALL (with filters + summary cards) ─
  getAll: async (req, res) => {
    const filters = getUnifiedPaymentsSchema.parse(req.query);
    const result  = await service.getAllUnifiedPayments(filters, req.user);
    return res.status(200).json({
      success:    true,
      data:       result.payments,
      pagination: result.pagination,
      summary:    result.summary,      // totalIncoming, totalOutgoing, netProfit, totalPending
    });
  },

  // ── GET SINGLE ─────────────────────────────
  getById: async (req, res) => {
    const payment = await service.getUnifiedPaymentById(req.params.id);
    return ApiResponse.success(res, payment);
  },

  // ── MANUAL CREATE ──────────────────────────
  create: async (req, res) => {
    const data    = createUnifiedPaymentSchema.parse(req.body);
    const payment = await service.createManualPayment(data, req.user?.id);
    return ApiResponse.created(res, payment, 'Payment recorded');
  },

  // ── UPDATE (manual only) ───────────────────
  update: async (req, res) => {
    const data    = updateUnifiedPaymentSchema.parse(req.body);
    const payment = await service.updateManualPayment(req.params.id, data, req.user?.id);
    return ApiResponse.success(res, payment, 'Payment updated');
  },

  // ── DELETE (ADMIN, manual only) ────────────
  delete: async (req, res) => {
    await service.deleteUnifiedPayment(req.params.id);
    return ApiResponse.success(res, null, 'Payment deleted');
  },

  // ── SUMMARY CARDS ──────────────────────────
  getSummary: async (req, res) => {
    const summary = await service.getPaymentSummary(req.user);
    return ApiResponse.success(res, summary);
  },

  // ── CUSTOMER PROFILE ───────────────────────
  getCustomerProfile: async (req, res) => {
    const result = await service.getCustomerPaymentProfile(req.params.customerId);
    return ApiResponse.success(res, result);
  },

  // ── VENDOR PROFILE ─────────────────────────
  getVendorProfile: async (req, res) => {
    const result = await service.getVendorPaymentProfile(req.params.vendorId);
    return ApiResponse.success(res, result);
  },

  // ── EXPORT ─────────────────────────────────
  export: async (req, res) => {
    const filters = exportUnifiedPaymentsSchema.parse(req.query);
    const rows    = await service.exportUnifiedPayments(filters, req.user);

    if (filters.format === 'excel') {
      return res.status(200).json({ success: true, data: rows, count: rows.length });
    }

    const csv = rowsToCsv(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payments_${Date.now()}.csv"`);
    return res.status(200).send(csv);
  },

};

export default unifiedPaymentController;