const express = require('express');
const multer = require('multer');
const { uploadFile, getPresignedUrl } = require('./upload.controller');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

const router = express.Router();

// File upload endpoint with multer middleware
router.post('/', upload.single('file'), uploadFile);

// Generate presigned URL for existing file
router.get('/presigned/:storageKey', getPresignedUrl);

module.exports = router;
