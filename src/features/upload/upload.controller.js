const uploadService = require('./upload.service');

// Simple file upload handler (without multer for now)
async function uploadFile(req, res) {
  try {
    // Check if file exists in request
    if (!req.file && !req.body.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided',
      });
    }

    const file = req.file || req.body.file;
    const folder = req.body.folder || 'general';

    const result = await uploadService.uploadFile(file, folder);

    res.json({
      success: true,
      url: result.url,
      fileName: result.fileName,
      size: result.size,
    });
  } catch (error) {
    console.error('Upload controller error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file',
    });
  }
}

module.exports = {
  uploadFile,
};
