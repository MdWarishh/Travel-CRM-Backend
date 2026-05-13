import { Router } from 'express';
import * as c from './invoice.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─────────────────────────────────────────────
// COMPANY SETTINGS
// ─────────────────────────────────────────────
router.get('/settings/company', c.getCompanySettings);
router.put('/settings/company', authorize('ADMIN', 'MANAGER'), c.updateCompanySettings);
router.post('/settings/reset-numbering', authorize('ADMIN'), c.resetInvoiceNumbering);

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
router.get('/dashboard', c.getInvoiceDashboard);

// ─────────────────────────────────────────────
// INVOICES — CRUD
// ─────────────────────────────────────────────
router.get('/', c.getAllInvoices);
router.post('/', c.createInvoice);

// ── Lookup by invoice number (must be before /:id)
router.get('/number/:invoiceNumber', c.getInvoiceByNumber);

// ── Linked invoices (all before /:id to avoid route conflicts)
router.get('/customer/:customerId', c.getCustomerInvoices);
router.get('/booking/:bookingId',   c.getBookingInvoices);
router.get('/vendor/:vendorId',     c.getVendorInvoices);   // ← NEW

router.get('/:id',    c.getInvoiceById);
router.put('/:id',    c.updateInvoice);
router.delete('/:id', authorize('ADMIN', 'MANAGER'), c.deleteInvoice);

// ── Actions
router.post('/:id/send',      c.markAsSent);
router.post('/:id/duplicate', c.duplicateInvoice);

// ─────────────────────────────────────────────
// PAYMENTS
// ─────────────────────────────────────────────
router.get('/:id/payments',  c.getInvoicePayments);
router.post('/:id/payments', c.recordPayment);

router.patch('/:id/status', c.updateInvoiceStatus);

export default router;