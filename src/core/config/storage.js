const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { config } = require('./index');

// S3 Client for Neon Object Storage (S3-compatible)
const s3Client = new S3Client({
  endpoint: process.env.NEON_OBJECT_STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.NEON_OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.NEON_OBJECT_STORAGE_SECRET_ACCESS_KEY,
  },
  region: process.env.NEON_OBJECT_STORAGE_REGION || 'us-east-1',
  forcePathStyle: true, // Required for some S3-compatible services
});

const BUCKET_NAME = process.env.NEON_OBJECT_STORAGE_BUCKET || 'ema-store-images';

/**
 * Upload file to Neon Object Storage
 * @param {Buffer} buffer - File buffer
 * @param {string} key - Storage key (path)
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} Public URL
 */
async function uploadToStorage(buffer, key, contentType) {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await s3Client.send(command);
    console.log(`[Storage] Uploaded: ${key}`);
    
    // Generate presigned URL (valid for 1 hour)
    const urlCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    
    const url = await getSignedUrl(s3Client, urlCommand, { expiresIn: 3600 });
    console.log(`[Storage] Presigned URL: ${url}`);
    
    return url;
  } catch (error) {
    console.error('Storage upload error:', error);
    throw new Error('Failed to upload to cloud storage');
  }
}

/**
 * Generate presigned URL for existing file
 * @param {string} key - Storage key
 * @param {number} expiresIn - URL expiration in seconds (default: 3600 = 1 hour)
 * @returns {Promise<string>} Presigned URL
 */
async function getPresignedUrl(key, expiresIn = 3600) {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    console.log(`[Storage] Presigned URL: ${url}`);
    
    return url;
  } catch (error) {
    console.error('Presigned URL error:', error);
    throw new Error('Failed to generate presigned URL');
  }
}

/**
 * Delete file from Neon Object Storage
 * @param {string} key - Storage key
 * @returns {Promise<boolean>}
 */
async function deleteFromStorage(key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    console.log(`[Storage] Deleted: ${key}`);
    return true;
  } catch (error) {
    console.error('Storage delete error:', error);
    return false;
  }
}

module.exports = {
  uploadToStorage,
  getPresignedUrl,
  deleteFromStorage,
  BUCKET_NAME,
};
