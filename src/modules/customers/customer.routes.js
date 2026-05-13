import { Router } from 'express';
import * as c from './customer.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';

const router = Router();

router.use(authenticate);

// ═══════════════════════════════════════════════════════════════════════
// ⚠️  STATIC ROUTES MUST BE DEFINED BEFORE /:id
//     Otherwise Express matches "templates", "from-lead" etc. as :id
// ═══════════════════════════════════════════════════════════════════════

// ─── Communication Templates ──────────────────────────────────────────
router.get('/templates',                                            c.getTemplates);        // ?type=WHATSAPP|EMAIL
router.post('/templates',   authorize('ADMIN', 'MANAGER'),         c.createTemplate);
router.put('/templates/:templateId',  authorize('ADMIN', 'MANAGER'), c.updateTemplate);
router.delete('/templates/:templateId', authorize('ADMIN', 'MANAGER'), c.deleteTemplate);

// ─── WhatsApp / Email send (no :id in path) ───────────────────────────
router.post('/whatsapp/send', c.sendWhatsApp);
router.post('/email/send',    c.sendEmail);

// ─── Create from lead (static segment "from-lead") ────────────────────
router.post('/from-lead/:leadId', requirePermission('customers', 'create'), c.createCustomerFromLead);

// ═══════════════════════════════════════════════════════════════════════
// CUSTOMERS — CRUD  (dynamic :id — always LAST)
// ═══════════════════════════════════════════════════════════════════════
router.get('/',     requirePermission('customers', 'view'),   c.getAllCustomers);
router.post('/',    requirePermission('customers', 'create'), c.createCustomer);
router.get('/:id',  requirePermission('customers', 'view'),   c.getCustomerById);
router.put('/:id',  requirePermission('customers', 'edit'),   c.updateCustomer);
router.delete('/:id', authorize('ADMIN', 'MANAGER'),          c.deleteCustomer);

// ─── Timeline ─────────────────────────────────────────────────────────
router.get('/:id/timeline',       requirePermission('customers', 'view'), c.getCustomerTimeline);

// ─── Communications ───────────────────────────────────────────────────
router.get('/:id/communications', requirePermission('customers', 'view'), c.getCommunications);
router.post('/:id/pdf/share',     requirePermission('customers', 'edit'), c.sharePdf);

// ─── Notes ────────────────────────────────────────────────────────────
router.get('/:id/notes',              requirePermission('customers', 'view'), c.getNotes);
router.post('/:id/notes',             requirePermission('customers', 'edit'), c.addNote);
router.put('/:id/notes/:noteId',      requirePermission('customers', 'edit'), c.updateNote);
router.delete('/:id/notes/:noteId',   requirePermission('customers', 'edit'), c.deleteNote);

// ─── Activity Log ─────────────────────────────────────────────────────
router.get('/:id/activity', requirePermission('customers', 'view'), c.getActivityLog);

export default router;