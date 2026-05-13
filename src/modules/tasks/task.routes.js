import { Router } from 'express';
import * as taskController from './task.controller.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─── Dashboard stats ──────────────────────────────────────────────────────────
router.get('/stats', taskController.getTaskStats);

// ─── CRUD ─────────────────────────────────────────────────────────────────────
router.get('/',       taskController.getAllTasks);
router.post('/',      taskController.createTask);
router.get('/:id',    taskController.getTaskById);
router.put('/:id',    taskController.updateTask);
router.patch('/:id/status', taskController.updateTaskStatus);
router.delete('/:id', authorize('ADMIN', 'MANAGER', 'AGENT'), taskController.deleteTask);

export default router;