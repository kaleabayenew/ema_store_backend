const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// ── Multer configuration for chat image uploads ─────────────────────────────

// Storage in memory (we'll upload to Neon Object Storage in the controller)
const storage = multer.memoryStorage();

// File filter: only accept images
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images are allowed.'), false);
  }
};

// Multer instance
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
    files: 1, // Only one file at a time
  },
});

// Middleware for single image upload
const uploadChatImage = upload.single('image');

module.exports = {
  uploadChatImage,
};
