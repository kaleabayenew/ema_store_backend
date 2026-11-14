const crypto = require('crypto');

/**
 * AES-256-GCM payload encryption for browser admin traffic.
 *
 * The shared secret comes from API_PAYLOAD_SECRET (backend) /
 * VITE_API_PAYLOAD_SECRET (web, baked in at build time). Both sides derive
 * the same 32-byte key via SHA-256. This is obfuscation on top of TLS — it
 * stops casual inspection of request/response bodies in devtools, it is not
 * a substitute for HTTPS.
 *
 * Wire format: base64url(iv).base64url(tag).base64url(ciphertext)
 */

let cachedKey = null;

function getKey() {
  const secret = process.env.API_PAYLOAD_SECRET;
  if (!secret) return null;
  if (!cachedKey) cachedKey = crypto.createHash('sha256').update(secret, 'utf8').digest();
  return cachedKey;
}

function isEnabled() {
  return getKey() !== null;
}

function encryptJson(payload) {
  const key = getKey();
  if (!key) throw new Error('Payload encryption is not configured.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decryptJson(token) {
  const key = getKey();
  if (!key) throw new Error('Payload encryption is not configured.');
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('Malformed encrypted payload.');
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

module.exports = { isEnabled, encryptJson, decryptJson };
