import invoiceService from './invoice.service.js';
import {
  updateCompanySettingsSchema,
  resetInvoiceNumberSchema,
  createInvoiceSchema,
  updateInvoiceSchema,
  recordPaymentSchema,
  invoiceQuerySchema,
} from './invoice.validation.js';
import { ApiResponse } from '../../utils/helpers.js';

// ─────────────────────────────────────────────
// HELPER — parse Zod errors into readable messages
// ─────────────────────────────────────────────

function parseZodError(err) {
  const issues = err.issues ?? err.errors ?? [];
  return issues.map((e) => {
    const field = e.path?.join('.') || 'field';
    return `${field}: ${e.message}`;
  });
}

function handleZod(schema, data, res) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = parseZodError(result.error);
    res.status(400).json({ success: false, message: messages.join(' | ') });
    return null;
  }
  return result.data;
}

// ─────────────────────────────────────────────
// COMPANY SETTINGS
// ─────────────────────────────────────────────

export const getCompanySettings = async (req, res) => {
  const settings = await invoiceService.getCompanySettings();
  return ApiResponse.success(res, settings);
};

export const updateCompanySettings = async (req, res) => {
  const data = handleZod(updateCompanySettingsSchema, req.body, res);
  if (!data) return;
  const settings = await invoiceService.updateCompanySettings(data);
  return ApiResponse.success(res, settings, 'Company settings updated');
};

export const resetInvoiceNumbering = async (req, res) => {
  const data = handleZod(resetInvoiceNumberSchema, req.body, res);
  if (!data) return;
  const settings = await invoiceService.resetInvoiceNumbering(data);
  return ApiResponse.success(res, settings, 'Invoice numbering reset successfully');
};

// ─────────────────────────────────────────────
// INVOICES — CRUD
// ─────────────────────────────────────────────

export const getAllInvoices = async (req, res) => {
  const query = handleZod(invoiceQuerySchema, req.query, res);
  if (!query) return;
  const result = await invoiceService.getAllInvoices(query, req.user);
  return ApiResponse.paginated(res, result.invoices, result.pagination, result.stats);
};

export const getInvoiceDashboard = async (req, res) => {
  const data = await invoiceService.getInvoiceDashboard();
  return ApiResponse.success(res, data);
};

export const getInvoiceById = async (req, res) => {
  const invoice = await invoiceService.getInvoiceById(req.params.id);
  return ApiResponse.success(res, invoice);
};

export const getInvoiceByNumber = async (req, res) => {
  const invoice = await invoiceService.getInvoiceByNumber(req.params.invoiceNumber);
  return ApiResponse.success(res, invoice);
};

export const createInvoice = async (req, res) => {
  const data = handleZod(createInvoiceSchema, req.body, res);
  if (!data) return;
  const invoice = await invoiceService.createInvoice(data, req.user);
  return ApiResponse.created(res, invoice, 'Invoice created successfully');
};

export const updateInvoice = async (req, res) => {
  const data = handleZod(updateInvoiceSchema, req.body, res);
  if (!data) return;
  const invoice = await invoiceService.updateInvoice(req.params.id, data, req.user);
  return ApiResponse.success(res, invoice, 'Invoice updated successfully');
};

export const deleteInvoice = async (req, res) => {
  await invoiceService.deleteInvoice(req.params.id);
  return ApiResponse.success(res, null, 'Invoice deleted');
};

export const markAsSent = async (req, res) => {
  const invoice = await invoiceService.markInvoiceAsSent(req.params.id);
  return ApiResponse.success(res, invoice, 'Invoice marked as sent');
};

export const duplicateInvoice = async (req, res) => {
  const invoice = await invoiceService.duplicateInvoice(req.params.id, req.user);
  return ApiResponse.created(res, invoice, 'Invoice duplicated');
};

// ─────────────────────────────────────────────
// PAYMENTS
// ─────────────────────────────────────────────

export const recordPayment = async (req, res) => {
  const { id } = req.params;
  const data = handleZod(recordPaymentSchema, req.body, res);
  if (!data) return;
  const result = await invoiceService.recordPayment(id, data, req.user);
  return ApiResponse.success(res, result, 'Payment recorded');
};

export const getInvoicePayments = async (req, res) => {
  const payments = await invoiceService.getInvoicePayments(req.params.id);
  return ApiResponse.success(res, payments);
};

// ─────────────────────────────────────────────
// LINKED INVOICES
// ─────────────────────────────────────────────

export const getCustomerInvoices = async (req, res) => {
  const invoices = await invoiceService.getCustomerInvoices(req.params.customerId);
  return ApiResponse.success(res, invoices);
};

export const getBookingInvoices = async (req, res) => {
  const invoices = await invoiceService.getBookingInvoices(req.params.bookingId);
  return ApiResponse.success(res, invoices);
};

// NEW: get all invoices linked to a specific vendor
export const getVendorInvoices = async (req, res) => {
  const invoices = await invoiceService.getVendorInvoices(req.params.vendorId);
  return ApiResponse.success(res, invoices);
};

// Status directly update karne ke liye (PAID, SENT, CANCELLED etc.)
export const updateInvoiceStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const allowed = ['DRAFT', 'SENT', 'UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }

  const updated = await invoiceService.updateInvoiceStatus(id, status, req.user);
  return ApiResponse.success(res, updated, `Invoice marked as ${status}`);
};