import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../middleware/auth.middleware.js';
import { uploadImage, deleteImage } from './upload.controller.js';

// ─────────────────────────────────────────────
// Multer — memory storage (buffer → Cloudinary)
// No files written to disk.
// ─────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WEBP and GIF images are allowed'));
    }
  },
});

const router = Router();

router.use(authenticate);

// POST /api/v1/upload        — upload a single image
router.post('/', upload.single('file'), uploadImage);

// DELETE /api/v1/upload      — delete by publicId
router.delete('/', deleteImage);

export default router;