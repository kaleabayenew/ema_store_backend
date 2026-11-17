const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AppError } = require('../../core/errors/app_error');

const PROOFS_DIR = path.resolve(__dirname, '../../../uploads/proofs');

// Ensure directory exists
if (!fs.existsSync(PROOFS_DIR)) {
  fs.mkdirSync(PROOFS_DIR, { recursive: true });
}

/**
 * Validate magic bytes for images and videos.
 */
function validateMagicBytes(buffer, mimetype) {
  if (!buffer || buffer.length < 12) {
    throw new AppError('File buffer too small or corrupt.', 400, 'CORRUPT_FILE');
  }

  const hex = buffer.slice(0, 16).toString('hex').toLowerCase();

  // JPEG: starts with ffd8ffe0, ffd8ffe1, ffd8ffe2, ffd8ffdb, ffd8ffee
  if (hex.startsWith('ffd8ff')) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }

  // PNG: 89504e470d0a1a0a
  if (hex.startsWith('89504e470d0a1a0a')) {
    return { ext: 'png', mime: 'image/png' };
  }

  // WEBP: RIFF....WEBP
  if (hex.startsWith('52494646') && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }

  // GIF: GIF87a or GIF89a
  if (hex.startsWith('474946383761') || hex.startsWith('474946383961')) {
    return { ext: 'gif', mime: 'image/gif' };
  }

  // MP4 / MOV: typically contains 'ftyp' at offset 4
  const boxType = buffer.slice(4, 8).toString('ascii');
  if (boxType === 'ftyp' || boxType === 'moov') {
    const brand = buffer.slice(8, 12).toString('ascii').trim().toLowerCase();
    if (brand.includes('qt') || brand.includes('moov')) {
      return { ext: 'mov', mime: 'video/quicktime' };
    }
    return { ext: 'mp4', mime: 'video/mp4' };
  }

  // WebM / Matroska: 1a45dfa3
  if (hex.startsWith('1a45dfa3')) {
    return { ext: 'webm', mime: 'video/webm' };
  }

  // Fallback for trusted client mimetypes if magic bytes allow
  if (mimetype && (mimetype.startsWith('image/') || mimetype.startsWith('video/'))) {
    const ext = mimetype.includes('mp4') ? 'mp4'
      : mimetype.includes('webm') ? 'webm'
      : mimetype.includes('quicktime') || mimetype.includes('mov') ? 'mov'
      : mimetype.includes('png') ? 'png'
      : mimetype.includes('webp') ? 'webp'
      : 'jpg';
    return { ext, mime: mimetype };
  }

  throw new AppError(
    'Unsupported file format. Only photo (JPG, PNG, WEBP) and video (MP4, MOV, WEBM) proofs are supported.',
    400,
    'INVALID_FILE_TYPE',
  );
}

async function saveProofFile(fileBuffer, originalMimetype) {
  const { ext, mime } = validateMagicBytes(fileBuffer, originalMimetype);
  const randomSuffix = crypto.randomBytes(12).toString('hex');
  const filename = `proof_${Date.now()}_${randomSuffix}.${ext}`;
  const targetPath = path.join(PROOFS_DIR, filename);

  await fs.promises.writeFile(targetPath, fileBuffer);

  return {
    filename,
    url: `/api/v1/proof/file/${filename}`,
    mimeType: mime,
    size: fileBuffer.length,
    isVideo: mime.startsWith('video/'),
  };
}

function getProofFilePath(filename) {
  // Prevent directory traversal
  const safeName = path.basename(filename);
  const fullPath = path.join(PROOFS_DIR, safeName);
  if (!fs.existsSync(fullPath)) {
    throw new AppError('Proof file not found.', 404, 'FILE_NOT_FOUND');
  }
  return fullPath;
}

module.exports = {
  saveProofFile,
  getProofFilePath,
  PROOFS_DIR,
};
