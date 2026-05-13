import { Router } from 'express';
import controller from './unified_payment.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();
router.use(authenticate);

// ─────────────────────────────────────────────
// 📊 SUMMARY CARDS
// ─────────────────────────────────────────────

router.get('/summary', controller.getSummary);
// GET /unified-payments/summary
// → { totalIncoming, totalOutgoing, netProfit, totalPending, bySource[] }

// ─────────────────────────────────────────────
// 📦 EXPORT
// ─────────────────────────────────────────────

router.get('/export', controller.export);
// GET /unified-payments/export?format=csv&type=INCOMING&source=BOOKING&startDate=&endDate=

// ─────────────────────────────────────────────
// 👤 CUSTOMER PAYMENT PROFILE
// ─────────────────────────────────────────────

router.get('/customer/:customerId', controller.getCustomerProfile);
// GET /unified-payments/customer/:customerId
// → { customer, totalPaid, totalPending, payments[] }

// ─────────────────────────────────────────────
// 🏢 VENDOR PAYMENT PROFILE
// ─────────────────────────────────────────────

router.get('/vendor/:vendorId', controller.getVendorProfile);
// GET /unified-payments/vendor/:vendorId
// → { vendor, totalPaid, totalPending, payments[] }

// ─────────────────────────────────────────────
// 💳 CORE CRUD
// ─────────────────────────────────────────────

router
  .route('/')
  .get(controller.getAll)    // GET  /unified-payments?type&source&status&search&sort&startDate&endDate
  .post(controller.create);  // POST /unified-payments (manual entry)

router
  .route('/:id')
  .get(controller.getById)                              // GET    /unified-payments/:id
  .put(controller.update)                               // PUT    /unified-payments/:id (manual only)
  .delete(authorize('ADMIN'), controller.delete);       // DELETE /unified-payments/:id (ADMIN, manual only)

export default router;