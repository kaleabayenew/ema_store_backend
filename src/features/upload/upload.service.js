const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const {
  uploadToStorage,
  getPresignedUrl,
  deleteFromStorage,
  getObject,
  isStorageConfigured,
} = require('../../core/config/storage');

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};
const EXT_TO_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

/** Keep folder names safe: lowercase letters, digits, "-" and "_" only. */
const sanitizeFolder = (folder) => {
  const clean = String(folder || 'general')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
  return clean || 'general';
};

class UploadService {
  constructor() {
    this.uploadDir = path.join(process.cwd(), 'public', 'uploads');
    this.ensureUploadDir();
  }

  ensureUploadDir() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  /**
   * Build the permanent, publicly reachable URL of a stored file.
   * Presigned S3 links expire after an hour, so we never store those in the DB.
   * Instead we store this stable URL, which redirects/streams a fresh copy on demand.
   */
  buildPublicUrl(baseUrl, storageKey) {
    return `${baseUrl}/api/v1/upload/file?key=${encodeURIComponent(storageKey)}`;
  }

  async uploadFile(file, folder = 'general', baseUrl = '') {
    const safeFolder = sanitizeFolder(folder);
    const buffer = file.buffer || file.data;
    if (!buffer || buffer.length === 0) throw new Error('Empty file');

    // Pick a safe extension from the MIME type (falls back to the original name)
    const mimetype = file.mimetype || 'image/jpeg';
    let ext = MIME_TO_EXT[mimetype] || path.extname(file.originalname || file.name || '').toLowerCase();
    if (!EXT_TO_MIME[ext]) ext = '.jpg';

    const fileName = `${uuidv4()}${ext}`;
    const storageKey = `${safeFolder}/${fileName}`;
    let url;

    if (isStorageConfigured()) {
      try {
        await uploadToStorage(buffer, storageKey, mimetype);
        url = this.buildPublicUrl(baseUrl, storageKey);
      } catch (cloudError) {
        console.error('[Upload] Cloud upload failed, falling back to local disk:', cloudError.message);
      }
    }

    if (!url) {
      // Local-disk fallback (also used when object storage is not configured)
      const targetDir = path.join(this.uploadDir, safeFolder);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, fileName), buffer);
      url = `${baseUrl}/uploads/${safeFolder}/${fileName}`;
    }

    return { url, fileName, size: buffer.length, storageKey };
  }

  /**
   * Resolve a storage key to something that can be sent to the browser.
   * Returns { stream, contentType, contentLength } or null when not found.
   */
  async readFile(storageKey) {
    if (isStorageConfigured()) {
      try {
        const obj = await getObject(storageKey);
        return { stream: obj.body, contentType: obj.contentType, contentLength: obj.contentLength };
      } catch (err) {
        if (err.name !== 'NoSuchKey' && err.$metadata?.httpStatusCode !== 404) {
          console.error('[Upload] Storage read failed:', err.message);
        }
      }
    }
    const localPath = path.join(this.uploadDir, storageKey);
    if (localPath.startsWith(this.uploadDir) && fs.existsSync(localPath)) {
      return {
        stream: fs.createReadStream(localPath),
        contentType: EXT_TO_MIME[path.extname(localPath).toLowerCase()],
        contentLength: fs.statSync(localPath).size,
      };
    }
    return null;
  }

  async getPresignedUrl(storageKey, expiresIn = 3600) {
    return getPresignedUrl(storageKey, expiresIn);
  }

  async deleteFile(url) {
    try {
      let storageKey;
      try {
        storageKey = new URL(url, 'http://x').searchParams.get('key');
      } catch (_) { /* not a URL */ }
      if (!storageKey) storageKey = String(url).split('/').slice(-2).join('/');

      if (isStorageConfigured()) await deleteFromStorage(storageKey);

      const filePath = path.join(this.uploadDir, storageKey);
      if (filePath.startsWith(this.uploadDir) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    } catch (error) {
      console.error('Delete error:', error);
      return false;
    }
  }
}

module.exports = new UploadService();
module.exports.sanitizeFolder = sanitizeFolder;