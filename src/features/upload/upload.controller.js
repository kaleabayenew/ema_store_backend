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

// Generate presigned URL for existing file
async function getPresignedUrl(req, res) {
  try {
    const { storageKey } = req.params;
    const expiresIn = parseInt(req.query.expiresIn) || 3600;

    if (!storageKey) {
      return res.status(400).json({
        success: false,
        message: 'Storage key is required',
      });
    }

    const url = await uploadService.getPresignedUrl(storageKey, expiresIn);

    res.json({
      success: true,
      url,
      expiresIn,
    });
  } catch (error) {
    console.error('Presigned URL controller error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate presigned URL',
    });
  }
}

module.exports = {
  uploadFile,
  getPresignedUrl,
};
