import { v2 as cloudinary } from 'cloudinary';
import { ApiResponse } from '../../utils/helpers.js';

// ─────────────────────────────────────────────
// Cloudinary config — add to your .env:
//   CLOUDINARY_CLOUD_NAME=your_cloud_name
//   CLOUDINARY_API_KEY=your_api_key
//   CLOUDINARY_API_SECRET=your_api_secret
// ─────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * POST /api/v1/upload
 * Body: multipart/form-data  { file: <binary>, folder?: string }
 * Returns: { url, publicId, width, height, format, bytes }
 *
 * folder values used in the app:
 *   itineraries/hero       → Basic Details hero image
 *   itineraries/days       → Day images
 *   itineraries/qr         → UPI QR codes (Accounts tab)
 *   itineraries/thankyou   → Thank You background
 */
export const uploadImage = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const folder = req.body.folder || 'itineraries/general';

  // Upload from memory buffer — no temp files on disk
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(req.file.buffer);
  });

  return ApiResponse.success(res, {
    url:      result.secure_url,
    publicId: result.public_id,
    width:    result.width,
    height:   result.height,
    format:   result.format,
    bytes:    result.bytes,
  });
};

/**
 * DELETE /api/v1/upload
 * Body: { publicId: string }
 * Deletes an image from Cloudinary (used when user clears an image)
 */
export const deleteImage = async (req, res) => {
  const { publicId } = req.body;
  if (!publicId) {
    return res.status(400).json({ success: false, message: 'publicId required' });
  }
  await cloudinary.uploader.destroy(publicId);
  return ApiResponse.success(res, null, 'Image deleted');
};