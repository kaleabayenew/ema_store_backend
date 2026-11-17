const express = require('express');
const multer = require('multer');
const { uploadProof, serveFile } = require('./proof.controller');
const { resolveDeliveryAgent } = require('../orders/order_flow');
const { AppError } = require('../../core/errors/app_error');
const { jwtSecret } = require('../../core/config');
const jwt = require('jsonwebtoken');

const router = express.Router();

const MAX_PROOF_SIZE = 25 * 1024 * 1024; // 25 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROOF_SIZE, files: 1 },
});

const handleMulter = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof AppError) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('Proof file exceeds 25MB limit.', 413, 'FILE_TOO_LARGE'));
    }
    return next(new AppError(err.message || 'Error processing proof upload.', 400, 'UPLOAD_ERROR'));
  });
};

/**
 * Dual authentication middleware:
 * Either standard Bearer JWT or x-agent-code delivery agent header.
 */
async function requireProofAuth(req, _res, next) {
  // 1. Check for x-agent-code header
  const agentCode = req.headers['x-agent-code'] || req.query.agentCode;
  if (agentCode) {
    try {
      const agent = await resolveDeliveryAgent(req);
      if (agent) {
        req.deliveryAgent = agent;
        return next();
      }
    } catch (e) {
      // Continue checking Bearer token
    }
  }

  // 2. Check for Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, jwtSecret);
      req.user = decoded;
      return next();
    } catch (_) {
      // Invalid Bearer token
    }
  }

  // If neither authenticated
  return next(new AppError('Authentication required to upload proof (Bearer token or x-agent-code).', 401, 'UNAUTHORIZED'));
}

// POST /api/v1/proof/upload
router.post('/upload', requireProofAuth, handleMulter, uploadProof);

// GET /api/v1/proof/file/:filename (public serving with immutable cache)
router.get('/file/:filename', serveFile);

module.exports = router;
