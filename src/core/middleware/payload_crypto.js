const { isEnabled, encryptJson, decryptJson } = require('../utils/payload_crypto');
const { error } = require('../utils/response');

/**
 * payloadCrypto — opt-in per request via the `x-payload-enc: 1` header.
 *
 * Request:  body { __enc: "iv.tag.ct" } is decrypted back into req.body.
 * Response: res.json() output is wrapped as { __enc: "iv.tag.ct" } so error
 *           bodies are unreadable in devtools too.
 *
 * Requests without the header pass through untouched (mobile app, curl,
 * server-to-server). Multipart bodies are never decrypted — they have no
 * __enc field, so they pass through; their JSON responses are still wrapped
 * when the header is present.
 */
module.exports = function payloadCrypto(req, res, next) {
  if (req.headers['x-payload-enc'] !== '1' || !isEnabled()) return next();

  // Decrypt request body when present.
  const enc = req.body && typeof req.body === 'object' ? req.body.__enc : null;
  if (enc !== undefined && enc !== null) {
    if (typeof enc !== 'string') {
      return error(res, 'Invalid encrypted payload.', 400, 'BAD_ENCRYPTED_BODY');
    }
    try {
      req.body = decryptJson(enc);
    } catch {
      return error(res, 'Could not decrypt request payload.', 400, 'BAD_ENCRYPTED_BODY');
    }
  }

  // Encrypt every JSON response for this request (success and error paths
  // both go through res.json via the ok/error helpers and errorHandler).
  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson({ __enc: encryptJson(body) });

  next();
};
