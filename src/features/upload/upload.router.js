const express = require('express');
const multer = require('multer');
const { uploadFile, serveFile, getPresignedUrl } = require('./upload.controller');
const { requireAuth, requireStaff } = require('../../core/middleware/auth');
const { AppError } = require('../../core/errors/app_error');

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new AppError('Only JPG, PNG, WEBP, GIF or AVIF images are allowed.', 400, 'INVALID_FILE_TYPE'));
  },
});

// Turn multer errors into clean 4xx responses instead of a generic 500
const handleUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof AppError) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('Image is too large. Maximum size is 5MB.', 413, 'FILE_TOO_LARGE'));
    }
    if (err.name === 'MulterError') {
      return next(new AppError(`Upload error: ${err.message}`, 400, 'UPLOAD_ERROR'));
    }
    return next(new AppError('Could not read the uploaded file.', 400, 'UPLOAD_ERROR'));
  });
};

const router = express.Router();

// Upload — any signed-in user (admin panel + partner portal)
router.post('/', requireAuth, handleUpload, uploadFile);

// Permanent public image URL (never expires, unlike presigned links)
router.get('/file', serveFile);

// Presigned URL for an existing file — staff only
router.get('/presigned/:storageKey', requireAuth, requireStaff, getPresignedUrl);

module.exports = router;