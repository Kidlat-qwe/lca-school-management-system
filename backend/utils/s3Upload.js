import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, S3_BUCKET_NAME } from '../config/s3Client.js';
import crypto from 'crypto';

/**
 * Upload a file to S3
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - File name (with path)
 * @param {string} contentType - MIME type
 * @param {Object} metadata - Optional metadata
 * @returns {Promise<Object>} Upload result with URL
 */
export const uploadToS3 = async (fileBuffer, fileName, contentType, metadata = {}) => {
  try {
    // Generate ETag for cache busting
    const etag = crypto.createHash('md5').update(fileBuffer).digest('hex');

    const uploadParams = {
      Bucket: S3_BUCKET_NAME,
      Key: fileName,
      Body: fileBuffer,
      ContentType: contentType,
      // Note: ACL is not used when bucket has ACLs disabled
      // Public access is controlled by bucket policy instead
      // Add metadata
      Metadata: {
        uploadedAt: new Date().toISOString(),
        etag,
        ...metadata,
      },
      // Cache control (optional)
      CacheControl: 'public, max-age=31536000', // 1 year
    };

    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);

    // Generate public URL
    const region = process.env.AWS_REGION || 'us-east-1';
    // Use default S3 endpoint format: https://bucket-name.s3.region.amazonaws.com/key
    const publicUrl = `https://${S3_BUCKET_NAME}.s3.${region}.amazonaws.com/${fileName}`;

    console.log(`✅ File uploaded to S3: ${fileName}`);

    return {
      success: true,
      url: publicUrl,
      key: fileName,
      bucket: S3_BUCKET_NAME,
      etag,
    };
  } catch (error) {
    console.error('❌ S3 upload error:', error);
    throw new Error(`Failed to upload file to S3: ${error.message}`);
  }
};

/**
 * Delete a file from S3
 * @param {string} fileName - File name (with path) or full URL
 * @returns {Promise<Object>} Delete result
 */
export const deleteFromS3 = async (fileName) => {
  try {
    // Extract key from URL if full URL is provided
    let key = fileName;
    if (fileName.includes('amazonaws.com') || fileName.includes(S3_BUCKET_NAME)) {
      // Extract key from URL
      const urlParts = fileName.split(`${S3_BUCKET_NAME}/`);
      key = urlParts[urlParts.length - 1];
    }

    const deleteParams = {
      Bucket: S3_BUCKET_NAME,
      Key: key,
    };

    const command = new DeleteObjectCommand(deleteParams);
    await s3Client.send(command);

    console.log(`🗑️ File deleted from S3: ${key}`);

    return {
      success: true,
      message: 'File deleted successfully',
      key,
    };
  } catch (error) {
    console.error('❌ S3 delete error:', error);
    // Don't throw error for delete failures (file might not exist)
    return {
      success: false,
      message: error.message,
    };
  }
};

/**
 * Generate a pre-signed URL for temporary access to a private file
 * @param {string} fileName - File name (with path)
 * @param {number} expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns {Promise<string>} Pre-signed URL
 */
export const getSignedUrlForFile = async (fileName, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: fileName,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });

    return signedUrl;
  } catch (error) {
    console.error('❌ S3 signed URL error:', error);
    throw new Error(`Failed to generate signed URL: ${error.message}`);
  }
};

/**
 * Validate image file
 * @param {Object} file - File object from multer
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
export const validateImageFile = (file) => {
  // Check file size
  const maxSize = parseInt(process.env.MAX_FILE_SIZE || '5242880'); // 5MB default
  if (file.size > maxSize) {
    throw new Error(`File size exceeds maximum allowed size of ${maxSize / (1024 * 1024)}MB`);
  }

  // Check file type
  const allowedTypes = (process.env.ALLOWED_IMAGE_TYPES || 'image/jpeg,image/png,image/webp,image/gif').split(',');
  if (!allowedTypes.includes(file.mimetype)) {
    throw new Error(`File type ${file.mimetype} is not allowed. Allowed types: ${allowedTypes.join(', ')}`);
  }

  return true;
};

/**
 * Generate unique filename
 * @param {string} prefix - Folder prefix (e.g., 'psms/merchandise-images/merchandise', 'psms/user-avatars')
 * @param {string} originalName - Original filename
 * @param {string|number} identifier - Unique identifier (user ID, merchandise ID, etc.)
 * @returns {string} Unique filename with path
 */
export const generateUniqueFileName = (prefix, originalName, identifier = '') => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(8).toString('hex');
  const extension = originalName.split('.').pop().toLowerCase();
  const sanitizedIdentifier = identifier.toString().replace(/[^a-zA-Z0-9]/g, '_');

  return `${prefix}/${sanitizedIdentifier}_${timestamp}_${randomString}.${extension}`;
};

