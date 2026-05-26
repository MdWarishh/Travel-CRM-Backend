import { Router } from 'express';
import * as ticketController from './ticket.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { permissionMiddleware as pm } from './ticket.controller.js';
import { AppError } from '../../utils/helpers.js';

const router = Router();

// ─── All routes require authentication ───────────────────────────────────────
router.use(authenticate);

// ─── Dashboard Stats ─────────────────────────────────────────────────────────
router.get('/stats', ticketController.getDashboardStats);

// ─── Matching Engine ─────────────────────────────────────────────────────────
router.get('/matches', ticketController.getMatches);

// ─────────────────────────────────────────────────────────────────────────────
// AGENT PERMISSIONS
// ─────────────────────────────────────────────────────────────────────────────

// GET all permissions — ADMIN + MANAGER only
router.get(
  '/permissions',
  authorize('ADMIN', 'MANAGER'),
  ticketController.getAllAgentPermissions
);

// GET own or specific user permissions
// ✅ FIX: User apni khud ki permissions fetch kar sakta hai
//         ADMIN/MANAGER kisi bhi user ki fetch kar sakte hain
router.get('/permissions/:userId', async (req, res, next) => {
  try {
    const isSelf = req.params.userId === req.user.id;
    const isAdminOrManager =
      req.user.role === 'ADMIN' || req.user.role === 'MANAGER';

    if (!isSelf && !isAdminOrManager) {
      throw new AppError('Access denied.', 403);
    }
    next();
  } catch (err) {
    next(err);
  }
}, ticketController.getAgentPermissions);

// POST upsert permissions — ADMIN only
router.post(
  '/permissions',
  authorize('ADMIN'),
  ticketController.upsertAgentPermissions
);

// ─────────────────────────────────────────────────────────────────────────────
// SELLERS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/sellers',        pm.viewSellers,   ticketController.getAllSellers);
router.get('/sellers/:id',    pm.viewSellers,   ticketController.getSellerById);
router.post('/sellers',       pm.addSellers,    ticketController.createSeller);
router.put('/sellers/:id',    pm.editSellers,   ticketController.updateSeller);
router.patch('/sellers/:id',  pm.editSellers,   ticketController.updateSeller);
router.delete('/sellers/:id', pm.deleteSellers, ticketController.deleteSeller);

// ─────────────────────────────────────────────────────────────────────────────
// BUYERS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/buyers',        pm.viewBuyers,   ticketController.getAllBuyers);
router.get('/buyers/:id',    pm.viewBuyers,   ticketController.getBuyerById);
router.post('/buyers',       pm.addBuyers,    ticketController.createBuyer);
router.put('/buyers/:id',    pm.editBuyers,   ticketController.updateBuyer);
router.patch('/buyers/:id',  pm.editBuyers,   ticketController.updateBuyer);
router.delete('/buyers/:id', pm.deleteBuyers, ticketController.deleteBuyer);

// ─────────────────────────────────────────────────────────────────────────────
// DEALS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/deals',        pm.viewDeals,   ticketController.getAllDeals);
router.get('/deals/:id',    pm.viewDeals,   ticketController.getDealById);
router.post('/deals',       pm.addDeals,    ticketController.connectDeal);
router.put('/deals/:id',    pm.editDeals,   ticketController.updateDeal);
router.patch('/deals/:id',  pm.editDeals,   ticketController.updateDeal);
router.delete('/deals/:id', pm.deleteDeals, ticketController.deleteDeal);

// WhatsApp link — ADMIN + MANAGER only
router.get(
  '/deals/:id/whatsapp',
  authorize('ADMIN', 'MANAGER'),
  ticketController.getWhatsAppLink
);

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT LEDGER
// ─────────────────────────────────────────────────────────────────────────────
router.get('/deals/:id/payments',  pm.viewDeals, ticketController.getDealPayments);
router.post('/deals/:id/payments', pm.editDeals, ticketController.addPayment);
router.delete(
  '/payments/:paymentId',
  authorize('ADMIN', 'MANAGER'),
  ticketController.deletePayment
);

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reports/revenue', pm.viewReports, ticketController.getRevenueReport);

// ─────────────────────────────────────────────────────────────────────────────
// BULK IMPORT
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/import/history',
  authorize('ADMIN', 'MANAGER'),
  ticketController.getImportHistory
);
router.post('/import', pm.importData, ticketController.bulkImport);

export default router;