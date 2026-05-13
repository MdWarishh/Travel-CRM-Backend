import { Router } from 'express';
import * as ticketController from './ticket.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { permissionMiddleware as pm } from './ticket.controller.js';

const router = Router();

// ─── All routes require authentication ───────────────────────────────────────
router.use(authenticate);

// ─── Dashboard Stats ─────────────────────────────────────────────────────────
router.get('/stats', ticketController.getDashboardStats);

// ─── Matching Engine ─────────────────────────────────────────────────────────
router.get('/matches', ticketController.getMatches);

// ─────────────────────────────────────────────────────────────────────────────
// AGENT PERMISSIONS (ADMIN only)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/permissions',              authorize('ADMIN', 'MANAGER'), ticketController.getAllAgentPermissions);
router.get('/permissions/:userId',      authorize('ADMIN', 'MANAGER'), ticketController.getAgentPermissions);
router.post('/permissions',             authorize('ADMIN'),            ticketController.upsertAgentPermissions);

// ─────────────────────────────────────────────────────────────────────────────
// SELLERS
// Agents: need canViewSellers / canAddSellers / canEditSellers / canDeleteSellers
// ADMIN & MANAGER bypass all permission checks (handled inside checkTicketPermission)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/sellers',          pm.viewSellers,   ticketController.getAllSellers);
router.get('/sellers/:id',      pm.viewSellers,   ticketController.getSellerById);
router.post('/sellers',         pm.addSellers,    ticketController.createSeller);
router.put('/sellers/:id',      pm.editSellers,   ticketController.updateSeller);
router.patch('/sellers/:id',    pm.editSellers,   ticketController.updateSeller);
router.delete('/sellers/:id',   pm.deleteSellers, ticketController.deleteSeller);

// ─────────────────────────────────────────────────────────────────────────────
// BUYERS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/buyers',           pm.viewBuyers,   ticketController.getAllBuyers);
router.get('/buyers/:id',       pm.viewBuyers,   ticketController.getBuyerById);
router.post('/buyers',          pm.addBuyers,    ticketController.createBuyer);
router.put('/buyers/:id',       pm.editBuyers,   ticketController.updateBuyer);
router.patch('/buyers/:id',     pm.editBuyers,   ticketController.updateBuyer);
router.delete('/buyers/:id',    pm.deleteBuyers, ticketController.deleteBuyer);

// ─────────────────────────────────────────────────────────────────────────────
// DEALS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/deals',            pm.viewDeals,   ticketController.getAllDeals);
router.get('/deals/:id',        pm.viewDeals,   ticketController.getDealById);
router.post('/deals',           pm.addDeals,    ticketController.connectDeal);
router.put('/deals/:id',        pm.editDeals,   ticketController.updateDeal);
router.patch('/deals/:id',      pm.editDeals,   ticketController.updateDeal);
router.delete('/deals/:id',     pm.deleteDeals, ticketController.deleteDeal);

// WhatsApp link
router.get('/deals/:id/whatsapp',
  authorize('ADMIN', 'MANAGER'),
  ticketController.getWhatsAppLink
);

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT LEDGER
// GET  /tickets/deals/:id/payments       — list all payments for a deal
// POST /tickets/deals/:id/payments       — add payment entry
// DELETE /tickets/payments/:paymentId    — delete payment entry (ADMIN only)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/deals/:id/payments',
  pm.viewDeals,
  ticketController.getDealPayments
);

router.post('/deals/:id/payments',
  pm.editDeals,
  ticketController.addPayment
);

router.delete('/payments/:paymentId',
  authorize('ADMIN', 'MANAGER'),
  ticketController.deletePayment
);

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS
// GET /tickets/reports/revenue?dateFrom=&dateTo=&groupBy=month|day
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reports/revenue',
  pm.viewReports,
  ticketController.getRevenueReport
);

// ─────────────────────────────────────────────────────────────────────────────
// BULK IMPORT
// POST /tickets/import          — bulk import records
// GET  /tickets/import/history  — view import history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/import/history',
  authorize('ADMIN', 'MANAGER'),
  ticketController.getImportHistory
);

router.post('/import',
  pm.importData,
  ticketController.bulkImport
);

export default router;