import { Router } from 'express';
import { getDashboard } from './dashboard.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);
router.get('/', getDashboard);

export default router;