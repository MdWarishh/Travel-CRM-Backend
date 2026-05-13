import { Router } from 'express';
import * as stageController from './leadStage.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

router.use(authenticate);

router.get('/',                                          stageController.getAllStages);
router.post('/',    authorize('ADMIN', 'MANAGER'),       stageController.createStage);
router.put('/reorder', authorize('ADMIN', 'MANAGER'),   stageController.reorderStages);
router.put('/:id', authorize('ADMIN', 'MANAGER'),       stageController.updateStage);
router.delete('/:id', authorize('ADMIN', 'MANAGER'),    stageController.deleteStage);

export default router;