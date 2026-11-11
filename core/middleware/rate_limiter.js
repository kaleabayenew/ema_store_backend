const { AppError } = require('../errors/app_error');

/**
 * Small in-memory rate limiter (fixed window).
 *
 * NOTE: limits are per-process. If the API ever runs on several servers,
 * move this to Redis (or the gateway) so the counters are shared.
 *
 * Options:
 *   windowMs         time window in milliseconds
 *   max              max requests per key inside the window
 *   keyFn(req)       builds the key (default: client IP)
 *   message / code   error returned with HTTP 429
 *   skipSuccessful   if true, successful responses (status < 400) are not counted
 *   hideRemaining    if true, X-RateLimit-Remaining is not sent (IP-only limiters)
 */

const MAX_KEYS = 50_000;

function createRateLimiter({
  windowMs,
  max,
  keyFn = (req) => req.ip,
  message = 'Too many requests. Please try again later.',
  code = 'RATE_LIMITED',
  skipSuccessful = false,
  hideRemaining = false,
}) {
  const hits = new Map(); // key → { count, resetAt, exceeded }

  // Clean expired entries every minute (unref so it never blocks shutdown)
  const cleaner = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, 60_000);
  cleaner.unref();

  const sweepExpired = (now) => {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  };

  return (req, res, next) => {
    const now = Date.now();
    const key = keyFn(req);

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs, exceeded: false };
      hits.set(key, entry);
    }

    // Memory cap: never grow past MAX_KEYS — fail closed with 429.
    if (hits.size > MAX_KEYS) {
      sweepExpired(now);
      if (hits.size > MAX_KEYS && !hits.has(key)) {
        return next(new AppError(message, 429, code));
      }
    }

    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.set('X-RateLimit-Limit', String(max));
    if (!hideRemaining) {
      res.set('X-RateLimit-Remaining', String(remaining));
    }

    if (entry.count > max) {
      entry.exceeded = true;
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return next(new AppError(message, 429, code));
    }

    if (skipSuccessful) {
      res.on('finish', () => {
        // Decrement only for real successes, and never once the window has
        // been exceeded — otherwise interleaved successes reset the counter.
        if (res.statusCode < 400 && !entry.exceeded && entry.count > 0) {
          entry.count -= 1;
        }
      });
    }

    next();
  };
}

/**
 * Normalize a login identifier so different phone spellings share one key:
 * "0912345678", "912345678", "+251912345678", "251 91 234 5678" → same key.
 * Phones → digits only, last 9 digits. Emails → trim + lowercase.
 */
const identifierOf = (req) => {
  const raw = String(
    (req.body && (req.body.phone || req.body.email)) || '',
  ).slice(0, 128);
  if (!raw) return '';
  if (raw.includes('@')) {
    return `e:${raw.trim().toLowerCase()}`.slice(0, 64);
  }
  const digits = raw.replace(/\D/g, '');
  return `p:${digits.slice(-9)}`.slice(0, 64);
};

const MINUTE = 60 * 1000;

// ── Ready-to-use limiters ────────────────────────────────────────────────────

/** Login: 10 failed attempts per 15 min for the same IP + phone/email. */
const loginLimiter = createRateLimiter({
  windowMs: 15 * MINUTE,
  max: 10,
  keyFn: (req) => `login|${req.ip}|${identifierOf(req)}`,
  message: 'Too many login attempts. Please try again in a few minutes.',
  code: 'TOO_MANY_LOGIN_ATTEMPTS',
  skipSuccessful: true,
});

/** Login (IP only): stops one IP from trying many different accounts. */
const loginIpLimiter = createRateLimiter({
  windowMs: 15 * MINUTE,
  max: 50,
  keyFn: (req) => `login-ip|${req.ip}`,
  message: 'Too many login attempts from this network. Please try again later.',
  code: 'TOO_MANY_LOGIN_ATTEMPTS',
  skipSuccessful: true,
  hideRemaining: true,
});

/** Sending OTPs (register, forgot password, resend): 5 per 15 min per IP + phone. */
const otpSendLimiter = createRateLimiter({
  windowMs: 15 * MINUTE,
  max: 5,
  keyFn: (req) => `otp-send|${req.ip}|${identifierOf(req)}`,
  message: 'Too many code requests. Please try again later.',
  code: 'TOO_MANY_OTP_REQUESTS',
});

/** Sending OTPs (IP only): 20 per hour per IP. */
const otpSendIpLimiter = createRateLimiter({
  windowMs: 60 * MINUTE,
  max: 20,
  keyFn: (req) => `otp-send-ip|${req.ip}`,
  message: 'Too many code requests from this network. Please try again later.',
  code: 'TOO_MANY_OTP_REQUESTS',
  hideRemaining: true,
});

/** Checking OTPs (register/verify, forgot-password/reset): 10 per 15 min per IP + phone. */
const otpVerifyLimiter = createRateLimiter({
  windowMs: 15 * MINUTE,
  max: 10,
  keyFn: (req) => `otp-verify|${req.ip}|${identifierOf(req)}`,
  message: 'Too many attempts. Please request a new code later.',
  code: 'TOO_MANY_OTP_ATTEMPTS',
});

/** Refresh token rotation: 30 per 15 min per IP. */
const refreshLimiter = createRateLimiter({
  windowMs: 15 * MINUTE,
  max: 30,
  keyFn: (req) => `refresh|${req.ip}`,
  message: 'Too many requests. Please try again later.',
  code: 'TOO_MANY_REQUESTS',
  hideRemaining: true,
});

module.exports = {
  createRateLimiter,
  loginLimiter,
  loginIpLimiter,
  otpSendLimiter,
  otpSendIpLimiter,
  otpVerifyLimiter,
  refreshLimiter,
};
