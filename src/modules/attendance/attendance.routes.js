import { Router } from 'express';
import * as c from './attendance.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

// ═══════════════════════════════════════════════════════════════════════
// ⚠️  STATIC ROUTES FIRST — before /:userId
// ═══════════════════════════════════════════════════════════════════════

// ─── User — own attendance ────────────────────────────────────────────
router.post('/check-in',  c.checkIn);          // POST /attendance/check-in
router.post('/check-out', c.checkOut);          // POST /attendance/check-out
router.get('/today',      c.getTodayAttendance); // GET  /attendance/today
router.get('/my',         c.getMyAttendance);    // GET  /attendance/my?month=5&year=2025

// ─── Admin — settings ────────────────────────────────────────────────
router.get('/settings',    authorize('ADMIN', 'MANAGER'), c.getSettings);
router.put('/settings',    authorize('ADMIN'),             c.updateSettings);

// ─── Admin — stats summary ───────────────────────────────────────────
router.get('/stats',       authorize('ADMIN', 'MANAGER'), c.getStats);

// ─── Admin — manual override ─────────────────────────────────────────
router.post('/override',   authorize('ADMIN', 'MANAGER'), c.manualOverride);

// ─── Admin — trigger auto-absent (also call via cron) ────────────────
router.post('/auto-absent', authorize('ADMIN'),           c.triggerAutoAbsent);

// ─── Admin — all records (list view) ─────────────────────────────────
router.get('/',            authorize('ADMIN', 'MANAGER'), c.getAllAttendance);

// ─── Admin — specific user (calendar view) — dynamic :userId LAST ────
router.get('/:userId',     authorize('ADMIN', 'MANAGER'), c.getUserAttendance);

export default router;