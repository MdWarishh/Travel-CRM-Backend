import { Router } from 'express';
import * as c from './report.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);
router.use(authorize('ADMIN', 'MANAGER'));

router.get('/leads', c.getLeadReport);
router.get('/conversions', c.getConversionReport);
router.get('/bookings', c.getBookingReport);
router.get('/payments', c.getPaymentReport);
router.get('/agent-performance', c.getAgentPerformanceReport);

export default router;