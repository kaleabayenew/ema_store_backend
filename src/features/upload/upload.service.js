const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { uploadToStorage, getPresignedUrl, deleteFromStorage } = require('../../core/config/storage');

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

  async uploadFile(file, folder = 'general') {
    try {
      // Create folder if it doesn't exist
      const targetDir = path.join(this.uploadDir, folder);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Generate unique filename
      const fileExtension = path.extname(file.originalname || file.name);
      const fileName = `${uuidv4()}${fileExtension}`;
      const filePath = path.join(targetDir, fileName);
      const storageKey = `${folder}/${fileName}`;

      // Write file to local disk (backup)
      const buffer = file.buffer || file.data;
      fs.writeFileSync(filePath, buffer);

      // Upload to Neon Object Storage
      let cloudUrl = null;
      try {
        cloudUrl = await uploadToStorage(buffer, storageKey, file.mimetype || 'image/jpeg');
        
        // Delete local file after successful cloud upload
        fs.unlinkSync(filePath);
        console.log(`[Upload] Local file deleted: ${filePath}`);
      } catch (cloudError) {
        console.error('[Upload] Cloud upload failed, keeping local file:', cloudError);
        // Return local URL as fallback
        cloudUrl = `/uploads/${folder}/${fileName}`;
      }

      return {
        url: cloudUrl,
        fileName,
        size: buffer.length,
        storageKey,
      };
    } catch (error) {
      console.error('Upload error:', error);
      throw new Error('Failed to upload file');
    }
  }

  async getPresignedUrl(storageKey, expiresIn = 3600) {
    try {
      return await getPresignedUrl(storageKey, expiresIn);
    } catch (error) {
      console.error('Presigned URL error:', error);
      throw new Error('Failed to generate presigned URL');
    }
  }

  async deleteFile(url) {
    try {
      // Try to extract storage key from URL
      const urlParts = url.split('/');
      const storageKey = urlParts.slice(-2).join('/');
      
      // Delete from cloud storage
      await deleteFromStorage(storageKey);
      
      // Delete from local disk if exists
      const filePath = path.join(process.cwd(), 'public', url);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      return true;
    } catch (error) {
      console.error('Delete error:', error);
      return false;
    }
  }
}

module.exports = new UploadService();
