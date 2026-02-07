import multer from 'multer';

/**
 * Multer configuration for handling file uploads
 * Stores files in memory as Buffer objects for processing before S3 upload
 */

// Memory storage - files are stored as Buffer in req.file.buffer
const storage = multer.memoryStorage();

// File filter for images only
const fileFilter = (req, file, cb) => {
  // Allowed MIME types
  const allowedTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Only ${allowedTypes.join(', ')} are allowed.`), false);
  }
};

// Create multer instance with configuration
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880'), // 5MB default
  },
});

// File filter for announcement attachments (documents + images)
const attachmentFileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'text/csv',
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed: PDF, Word, images, TXT, CSV. Got: ${file.mimetype}`), false);
  }
};

const uploadAttachment = multer({
  storage,
  fileFilter: attachmentFileFilter,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880') },
});

/**
 * Middleware for single image upload
 * Usage: upload.single('image')
 */
export const uploadSingle = upload.single('image');

/**
 * Middleware for single announcement attachment (PDF, doc, images, etc.)
 * Usage: uploadSingleAnnouncementAttachment (field name: 'attachment')
 */
export const uploadSingleAnnouncementAttachment = uploadAttachment.single('attachment');

/**
 * Middleware for multiple image uploads
 * Usage: upload.array('images', 10)
 */
export const uploadMultiple = (maxCount = 10) => upload.array('images', maxCount);

/**
 * Error handler middleware for multer errors
 */
export const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Multer-specific errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: `File too large. Maximum size is ${process.env.MAX_FILE_SIZE / (1024 * 1024)}MB`,
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files uploaded',
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  } else if (err) {
    // Other errors
    return res.status(400).json({
      success: false,
      message: err.message || 'Error uploading file',
    });
  }
  next();
};

export default upload;

