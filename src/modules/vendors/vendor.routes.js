/**
 * vendor.routes.js — Fixed
 *
 * CRITICAL FIX: Static routes (/stats, /suggest) MUST come before
 * parameterized routes (/:id). Express matches top-to-bottom — if /:id
 * comes first, then GET /stats gets matched as id="stats" and crashes.
 *
 * CORRECT ORDER:
 *   1. Static GET routes  (/stats, /suggest)
 *   2. Base CRUD          (/, /:id)
 *   3. Sub-routes         (/:id/status, /:id/notes, etc.)
 */

import { Router } from 'express';
import * as c from './vendor.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// ─── 1. Static routes — MUST be before /:id ──────────────────────────────────
router.get('/stats',   c.getVendorDashboardStats);
router.get('/suggest', c.suggestVendors);

// ─── 2. Base collection ───────────────────────────────────────────────────────
router.get('/',  c.getAllVendors);
router.post('/', authorize('ADMIN', 'MANAGER'), c.createVendor);

// ─── 3. Single resource ───────────────────────────────────────────────────────
router.get('/:id',    c.getVendorById);
router.put('/:id',    authorize('ADMIN', 'MANAGER'), c.updateVendor);
router.delete('/:id', authorize('ADMIN'),            c.deleteVendor);

// ─── 4. Status actions ────────────────────────────────────────────────────────
router.patch('/:id/status',           authorize('ADMIN', 'MANAGER'), c.changeVendorStatus);
router.patch('/:id/toggle-status',    authorize('ADMIN', 'MANAGER'), c.toggleVendorStatus);
router.patch('/:id/toggle-preferred', authorize('ADMIN', 'MANAGER'), c.togglePreferred);

// ─── 5. Notes ─────────────────────────────────────────────────────────────────
router.post('/:id/notes',             c.addNote);
router.put('/:id/notes/:noteId',      c.updateNote);
router.delete('/:id/notes/:noteId',   c.deleteNote);

export default router;