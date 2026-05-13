import { Router } from 'express';
import * as authController from './auth.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

// POST /api/v1/auth/login
router.post('/login', authController.login);

// GET /api/v1/auth/me
router.get('/me', authenticate, authController.getMe);

// POST /api/v1/auth/logout
router.post('/logout', authenticate, authController.logout);

// PUT /api/v1/auth/change-password
router.put('/change-password', authenticate, authController.changePassword);

export default router;