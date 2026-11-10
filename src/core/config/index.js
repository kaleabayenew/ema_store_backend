require('dotenv').config({ quiet: true });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const port = Number.parseInt(process.env.PORT || '3000', 10);

// ─────────────────────────────────────────────────────────────────────────────
//  Secrets — must be strong in production
// ─────────────────────────────────────────────────────────────────────────────
const WEAK_SECRETS = ['changeme', 'secret', 'jwt_secret', 'your-secret', 'password'];
const MIN_SECRET_LENGTH = 32;

function isWeakSecret(secret) {
  return (
    !secret ||
    secret.length < MIN_SECRET_LENGTH ||
    WEAK_SECRETS.includes(secret.toLowerCase())
  );
}

function resolveJwtSecret() {
  const secret = (process.env.JWT_SECRET || '').trim();

  if (!isWeakSecret(secret)) return secret;

  if (isProduction) {
    // Refuse to start: a weak secret lets anyone forge login tokens.
    throw new Error(
      `JWT_SECRET is missing or too weak. Set a random value of at least ${MIN_SECRET_LENGTH} characters. ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    );
  }

  console.warn(
    '[config] WARNING: JWT_SECRET is missing or weak. Using an insecure development secret. ' +
      'Do NOT use this in production.',
  );
  return secret || 'dev-only-insecure-secret-change-me-please-0123456789';
}

const jwtSecret = resolveJwtSecret();

// OTP codes are stored as HMAC hashes — this secret must differ from JWT_SECRET.
function resolveOtpHmacSecret() {
  const secret = (process.env.OTP_HMAC_SECRET || '').trim();
  const weak = isWeakSecret(secret) || secret === jwtSecret;

  if (!weak) return secret;

  if (isProduction) {
    throw new Error(
      'OTP_HMAC_SECRET is missing, too weak, or equal to JWT_SECRET. ' +
        'Set a different random value of at least 32 characters.',
    );
  }

  console.warn(
    '[config] WARNING: OTP_HMAC_SECRET is missing or weak. Using an insecure development secret. ' +
      'Do NOT use this in production.',
  );
  return 'dev-only-insecure-otp-hmac-secret-change-me-0123456789';
}

const otpHmacSecret = resolveOtpHmacSecret();

// ─────────────────────────────────────────────────────────────────────────────
//  Required infrastructure
// ─────────────────────────────────────────────────────────────────────────────
const databaseUrl = process.env.DATABASE_URL || '';
if (isProduction && !databaseUrl) {
  throw new Error('DATABASE_URL is not set. Refusing to start in production.');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Token lifetimes
// ─────────────────────────────────────────────────────────────────────────────
const accessTokenExpiresIn =
  process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';

const refreshDaysRaw = Number.parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10);
const refreshTokenDays = Number.isInteger(refreshDaysRaw)
  ? Math.min(90, Math.max(1, refreshDaysRaw))
  : 30;

// ─────────────────────────────────────────────────────────────────────────────
//  Proxy — number of trusted hops (for correct req.ip behind Render/nginx)
// ─────────────────────────────────────────────────────────────────────────────
const trustProxyRaw = process.env.TRUST_PROXY;
const trustProxy =
  trustProxyRaw !== undefined && trustProxyRaw !== ''
    ? Math.max(0, Number.parseInt(trustProxyRaw, 10) || 0)
    : isProduction
      ? 1
      : 0;

// ─────────────────────────────────────────────────────────────────────────────
//  CORS — allowed origins
//  Mobile apps (Android / iOS) send NO Origin header, so they are always allowed.
//  Only browsers (Flutter web, admin panel) are checked against this list.
// ─────────────────────────────────────────────────────────────────────────────
const fromEnvList = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const productionOrigins = [
  'https://ema-store-web.onrender.com',
  process.env.CUSTOMER_APP_URL,
  process.env.CUSTOMER_APP_URL_ANDROID,
  process.env.CUSTOMER_APP_URL_IOS,
  process.env.CUSTOMER_APP_URL_WEB,
  process.env.ADMIN_WEB_URL,
  ...fromEnvList,
].filter(Boolean);

// Local development servers (Flutter web picks a random port)
const LOCALHOST_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/;

// In production only https:// origins are trusted.
const allowedOrigins = [
  ...new Set(
    isProduction
      ? productionOrigins.filter((o) => o.startsWith('https://'))
      : productionOrigins,
  ),
];

/**
 * Decide if a browser origin may call the API.
 * - no Origin header (mobile app, curl, server-to-server) → allowed
 * - listed origin                                        → allowed
 * - localhost / 127.0.0.1 / 10.0.2.2                     → allowed only outside production
 */
function isOriginAllowed(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (!isProduction && LOCALHOST_PATTERN.test(origin)) return true;
  return false;
}

module.exports = Object.freeze({
  port: Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 3000,
  nodeEnv,
  isProduction,
  databaseUrl,
  jwtSecret,
  accessTokenExpiresIn,
  // Alias kept so old imports (jwtExpiresIn) do not break.
  jwtExpiresIn: accessTokenExpiresIn,
  refreshTokenDays,
  otpHmacSecret,
  trustProxy,
  allowedOrigins,
  isOriginAllowed,
  // Neon Object Storage
  storageEndpoint: process.env.NEON_OBJECT_STORAGE_ENDPOINT,
  storageBucket: process.env.NEON_OBJECT_STORAGE_BUCKET || 'ema-store-images',
  storageRegion: process.env.NEON_OBJECT_STORAGE_REGION || 'us-east-1',
});
