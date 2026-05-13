import { Router } from 'express';
import * as leadController from './lead.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';

const router = Router();

// ─── WEBHOOK — NO AUTH (public, protected by secret token in controller) ─────
router.post('/webhook/google-form', leadController.googleFormWebhook);

// ─── All routes below require authentication ──────────────────────────────────
router.use(authenticate);

// ─── Pipeline ─────────────────────────────────────────────────────────────────
// requirePermission checks CustomRole permissions, ADMIN always bypasses
router.get('/pipeline', requirePermission('leads', 'view'), leadController.getLeadPipeline);

// ─── Labels (global) ─────────────────────────────────────────────────────────
router.get('/labels',                                                    leadController.getAllLabels);
router.post('/labels',   authorize('ADMIN', 'MANAGER'),                  leadController.createLabel);
router.delete('/labels/:labelId', authorize('ADMIN', 'MANAGER'),         leadController.deleteLabel);

// ─── Excel / CSV Import ───────────────────────────────────────────────────────
router.post('/import', requirePermission('leads', 'create'), leadController.uploadMiddleware, leadController.importLeads);

// ─── Leads CRUD ───────────────────────────────────────────────────────────────
router.get('/',    requirePermission('leads', 'view'),   leadController.getAllLeads);
router.post('/',   requirePermission('leads', 'create'), leadController.createLead);
router.get('/:id', requirePermission('leads', 'view'),   leadController.getLeadById);
router.put('/:id', requirePermission('leads', 'edit'),   leadController.updateLead);
router.delete('/:id', authorize('ADMIN', 'MANAGER'),     leadController.deleteLead);

// ─── Lead actions ─────────────────────────────────────────────────────────────
router.patch('/:id/assign',  authorize('ADMIN', 'MANAGER'),                         leadController.assignLead);
router.post('/:id/convert',  authorize('ADMIN', 'MANAGER', 'AGENT'),                leadController.convertToCustomer);
router.patch('/:id/stage',   requirePermission('leads', 'edit'),                    leadController.changeLeadStage);
router.patch('/:id/rating',  requirePermission('leads', 'edit'),                    leadController.updateLeadRating);

// ─── Notes ───────────────────────────────────────────────────────────────────
router.post('/:id/notes',              requirePermission('leads', 'edit'),   leadController.addNote);
router.delete('/:id/notes/:noteId',    authorize('ADMIN', 'MANAGER'),        leadController.deleteNote);

// ─── Follow-ups ───────────────────────────────────────────────────────────────
router.get('/:id/followups',                                       leadController.getFollowUps);
router.post('/:id/followups',         requirePermission('leads', 'edit'),  leadController.createFollowUp);
router.patch('/:id/followups/:followUpId', requirePermission('leads', 'edit'), leadController.updateFollowUp);
router.delete('/:id/followups/:followUpId',  requirePermission('leads', 'edit'), leadController.deleteFollowUp);

// ─── Tasks ────────────────────────────────────────────────────────────────────
router.get('/:id/tasks',                                           leadController.getTasks);
router.post('/:id/tasks',          requirePermission('leads', 'edit'), leadController.createTask);
router.patch('/:id/tasks/:taskId', requirePermission('leads', 'edit'), leadController.updateTask);
router.delete('/:id/tasks/:taskId', requirePermission('leads', 'edit'), leadController.deleteTask);

// ─── Meetings ─────────────────────────────────────────────────────────────────
router.get('/:id/meetings',                                              leadController.getMeetings);
router.post('/:id/meetings',            requirePermission('leads', 'edit'), leadController.createMeeting);
router.patch('/:id/meetings/:meetingId',requirePermission('leads', 'edit'), leadController.updateMeeting);
router.delete('/:id/meetings/:meetingId',requirePermission('leads', 'edit'), leadController.deleteMeeting);

// ─── Labels (lead-specific) ───────────────────────────────────────────────────
router.post('/:id/labels',              requirePermission('leads', 'edit'), leadController.addLabelToLead);
router.delete('/:id/labels/:labelId',   requirePermission('leads', 'edit'), leadController.removeLabelFromLead);

// ─── Activity / History ───────────────────────────────────────────────────────
router.get('/:id/activities', requirePermission('leads', 'view'), leadController.getActivities);

// ─── Quotations ───────────────────────────────────────────────────────────────
router.get('/:id/quotations',                                                          leadController.getQuotations);
router.post('/:id/quotations',            requirePermission('leads', 'create'),        leadController.createQuotation);
router.patch('/:id/quotations/:quotationId', requirePermission('leads', 'edit'),       leadController.updateQuotation);
router.delete('/:id/quotations/:quotationId', authorize('ADMIN', 'MANAGER'),          leadController.deleteQuotation);

// ─── Lead Invoices ────────────────────────────────────────────────────────────
router.get('/:id/invoices',                                                            leadController.getLeadInvoices);
router.post('/:id/invoices',              requirePermission('leads', 'create'),        leadController.createLeadInvoice);
router.patch('/:id/invoices/:invoiceId',  requirePermission('leads', 'edit'),          leadController.updateLeadInvoice);
router.delete('/:id/invoices/:invoiceId', authorize('ADMIN', 'MANAGER'),               leadController.deleteLeadInvoice);

export default router;