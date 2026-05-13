import { Router } from 'express';
import * as c from './followup.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/today', c.getTodayFollowUps);
router.get('/', c.getAllFollowUps);
router.post('/', c.createFollowUp);
router.put('/:id', c.updateFollowUp);
router.delete('/:id', authorize('ADMIN', 'MANAGER'), c.deleteFollowUp);

export default router;