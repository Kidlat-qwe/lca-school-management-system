import express from 'express';
import { verifyFirebaseToken, requireRole } from '../middleware/auth.js';
import { uploadSingle, handleUploadError } from '../middleware/fileUpload.js';
import { uploadToS3, deleteFromS3, validateImageFile, generateUniqueFileName } from '../utils/s3Upload.js';

const router = express.Router();

/**
 * POST /api/sms/upload/merchandise-image
 * Upload merchandise image to S3
 * 
 * Request body (multipart/form-data):
 * - image: File (required)
 * - merchandiseName: string (optional)
 * - merchandiseId: number (optional)
 * 
 * Response:
 * - success: boolean
 * - imageUrl: string (S3 URL)
 * - message: string
 */
router.post(
  '/merchandise-image',
  verifyFirebaseToken,
  requireRole('Superadmin', 'Admin'),
  uploadSingle,
  handleUploadError,
  async (req, res, next) => {
    try {
      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No image file provided',
        });
      }

      // Validate image
      validateImageFile(req.file);

      // Get metadata from request
      const merchandiseName = req.body.merchandiseName || 'merchandise';
      const merchandiseId = req.body.merchandiseId || Date.now();

      // Generate unique filename
      // Path structure: psms/merchandise-images/merchandise/{name}_{id}_{timestamp}_{random}.jpg
      const sanitizedName = merchandiseName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const fileName = generateUniqueFileName(
        'psms/merchandise-images/merchandise',
        req.file.originalname,
        `${sanitizedName}_${merchandiseId}`
      );

      // Upload to S3
      const uploadResult = await uploadToS3(
        req.file.buffer,
        fileName,
        req.file.mimetype,
        {
          uploadedBy: req.user.user_id.toString(),
          merchandiseName,
          merchandiseId: merchandiseId.toString(),
        }
      );

      return res.status(200).json({
        success: true,
        imageUrl: uploadResult.url,
        key: uploadResult.key,
        message: 'Merchandise image uploaded successfully',
      });
    } catch (error) {
      console.error('Error uploading merchandise image:', error);
      next(error);
    }
  }
);

/**
 * POST /api/sms/upload/user-avatar
 * Upload user profile picture to S3
 * 
 * Request body (multipart/form-data):
 * - image: File (required)
 * 
 * Response:
 * - success: boolean
 * - imageUrl: string (S3 URL)
 * - message: string
 */
router.post(
  '/user-avatar',
  verifyFirebaseToken,
  uploadSingle,
  handleUploadError,
  async (req, res, next) => {
    try {
      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No image file provided',
        });
      }

      // Validate image
      validateImageFile(req.file);

      // Get user ID from authenticated user
      const userId = req.user.user_id;

      // Generate unique filename
      // Path structure: psms/user-avatars/{userId}_{timestamp}_{random}.jpg
      const fileName = generateUniqueFileName(
        'psms/user-avatars',
        req.file.originalname,
        userId
      );

      // Upload to S3
      const uploadResult = await uploadToS3(
        req.file.buffer,
        fileName,
        req.file.mimetype,
        {
          uploadedBy: userId.toString(),
          type: 'avatar',
        }
      );

      return res.status(200).json({
        success: true,
        imageUrl: uploadResult.url,
        key: uploadResult.key,
        message: 'Profile picture uploaded successfully',
      });
    } catch (error) {
      console.error('Error uploading user avatar:', error);
      next(error);
    }
  }
);

/**
 * DELETE /api/sms/upload/delete-image
 * Delete image from S3
 * 
 * Request body:
 * - imageUrl: string (required) - Full S3 URL or key
 * 
 * Response:
 * - success: boolean
 * - message: string
 */
router.delete(
  '/delete-image',
  verifyFirebaseToken,
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { imageUrl } = req.body;

      if (!imageUrl) {
        return res.status(400).json({
          success: false,
          message: 'Image URL is required',
        });
      }

      // Delete from S3
      const deleteResult = await deleteFromS3(imageUrl);

      return res.status(200).json({
        success: deleteResult.success,
        message: deleteResult.message || 'Image deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting image:', error);
      next(error);
    }
  }
);

export default router;

