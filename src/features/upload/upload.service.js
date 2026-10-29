const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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

      // Write file
      const buffer = file.buffer || file.data;
      fs.writeFileSync(filePath, buffer);

      // Return public URL
      const publicUrl = `/uploads/${folder}/${fileName}`;
      return {
        url: publicUrl,
        fileName,
        size: buffer.length,
      };
    } catch (error) {
      console.error('Upload error:', error);
      throw new Error('Failed to upload file');
    }
  }

  async deleteFile(url) {
    try {
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
