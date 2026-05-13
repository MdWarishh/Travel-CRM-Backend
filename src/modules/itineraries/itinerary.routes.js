import { Router } from 'express';
import * as c from './itinerary.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// ── Core CRUD ──────────────────────────────
router.get('/', c.getAllItineraries);
router.post('/', c.createItinerary);
router.get('/:id', c.getItineraryById);
router.put('/:id', c.updateItinerary);
router.delete('/:id', authorize('ADMIN', 'MANAGER'), c.deleteItinerary);

// ── Status ─────────────────────────────────
router.patch('/:id/status', c.updateStatus);

// ── Duplicate ──────────────────────────────
router.post('/:id/duplicate', c.duplicateItinerary);

// ── Day management ─────────────────────────
router.put('/:id/days', c.upsertDay);
router.delete('/:id/days/:dayId', c.deleteDay);

// ── PDF generation ─────────────────────────
// POST body: { leadId?, customerName?, travelDate?, numberOfTravelers? }
router.post('/:id/pdf', c.generatePdf);

export default router;