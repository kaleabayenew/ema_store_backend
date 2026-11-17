const fs = require('fs');
const mimeTypes = require('mime-types');
const proofService = require('./proof.service');
const { ok } = require('../../core/utils/response');
const { AppError } = require('../../core/errors/app_error');

async function uploadProof(req, res, next) {
  try {
    if (!req.file || !req.file.buffer) {
      throw new AppError('File is required in "file" field.', 400, 'FILE_REQUIRED');
    }

    const result = await proofService.saveProofFile(req.file.buffer, req.file.mimetype);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

async function serveFile(req, res, next) {
  try {
    const filename = req.params.filename;
    if (!filename) {
      throw new AppError('Filename is required.', 400, 'FILENAME_REQUIRED');
    }

    const filePath = proofService.getProofFilePath(filename);
    const contentType = mimeTypes.lookup(filePath) || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => next(err));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  uploadProof,
  serveFile,
};
