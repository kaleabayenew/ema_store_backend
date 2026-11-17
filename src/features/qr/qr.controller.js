const qrService = require('./qr.service');
const { ok, error } = require('../../core/utils/response');

/**
 * GET /api/v1/qr/my-code
 * Generates an encrypted 5-minute QR token for the authenticated user.
 */
async function getMyQrCode(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return error(res, 'Authentication required.', 401, 'UNAUTHORIZED');
    }

    const data = await qrService.generateUserQrToken(userId);
    return ok(res, data);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/qr/verify
 * Verifies/decrypts a scanned QR token.
 * If expired (> 5 min) or invalid, returns 404 with code EXPIRED or NOT_FOUND.
 */
async function verifyQrCode(req, res, next) {
  try {
    const qrToken = req.body.qrToken || req.body.code || req.body.token;
    if (!qrToken) {
      return error(res, 'QR code is required.', 400, 'BAD_REQUEST');
    }

    const result = await qrService.verifyQrToken(qrToken);

    if (!result.valid) {
      return res.status(404).json({
        success: false,
        code: result.code || 'NOT_FOUND',
        message: result.message || 'QR code expired or not found.',
        expiredAt: result.expiredAt || null,
      });
    }

    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMyQrCode,
  verifyQrCode,
};
