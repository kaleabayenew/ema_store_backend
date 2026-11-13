const uploadService = require('./upload.service');
const { AppError } = require('../../core/errors/app_error');

// Folders that must never be served through the public file endpoint
const PRIVATE_FOLDERS = new Set(['chat-images']);
const KEY_PATTERN = /^[a-z0-9_-]+\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|gif|avif)$/;

const getBaseUrl = (req) =>
  (process.env.PUBLIC_API_URL || process.env.BACKEND_PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

// POST /api/v1/upload  (multipart: file, folder?)
async function uploadFile(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError('No file provided. Send an image in the "file" field.', 400, 'NO_FILE');
    }
    const folder = req.body?.folder || 'general';
    const result = await uploadService.uploadFile(req.file, folder, getBaseUrl(req));

    res.json({
      success: true,
      url: result.url,
      fileName: result.fileName,
      size: result.size,
      storageKey: result.storageKey,
    });
  } catch (error) {
    console.error('Upload controller error:', error.message);
    next(error instanceof AppError ? error : new AppError('Failed to upload file. Please try again.', 500, 'UPLOAD_FAILED'));
  }
}

// GET /api/v1/upload/file?key=flash-deals/xxxx.jpg  (public, permanent image URL)
async function serveFile(req, res, next) {
  try {
    const key = String(req.query.key || '');
    const folder = key.split('/')[0];
    if (!KEY_PATTERN.test(key) || key.includes('..') || PRIVATE_FOLDERS.has(folder)) {
      throw new AppError('File not found.', 404, 'FILE_NOT_FOUND');
    }

    const file = await uploadService.readFile(key);
    if (!file) throw new AppError('File not found.', 404, 'FILE_NOT_FOUND');

    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    if (file.contentLength) res.setHeader('Content-Length', file.contentLength);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    file.stream.on('error', (e) => { console.error('[Upload] stream error:', e.message); res.destroy(); });
    file.stream.pipe(res);
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/upload/presigned/:storageKey  (staff only — see router)
async function getPresignedUrl(req, res, next) {
  try {
    const storageKey = decodeURIComponent(req.params.storageKey || '');
    const expiresIn = Math.min(parseInt(req.query.expiresIn, 10) || 3600, 86400);
    if (!storageKey || storageKey.includes('..')) {
      throw new AppError('Storage key is required', 400, 'INVALID_KEY');
    }
    const url = await uploadService.getPresignedUrl(storageKey, expiresIn);
    res.json({ success: true, url, expiresIn });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError('Failed to generate presigned URL', 500, 'PRESIGN_FAILED'));
  }
}

module.exports = { uploadFile, serveFile, getPresignedUrl };