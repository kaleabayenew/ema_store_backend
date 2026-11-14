const service = require('./auth.service');
const tokenService = require('./token.service');
const { ok, created, error } = require('../../core/utils/response');
const { storageEndpoint, isProduction, refreshTokenDays } = require('../../core/config');

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Auth responses must never be cached. */
const noStore = (res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
};

const invalidInput = (res) =>
  error(res, 'Invalid input.', 400, 'INVALID_INPUT');

// ── HttpOnly session cookie ──────────────────────────────────────────────────
// Holds the REFRESH token only (never the access token). Scoped to the auth
// routes so it is only sent to /auth/* endpoints. Browsers can't read it, so
// XSS cannot steal it; rotation on every /auth/refresh limits replay.
const SESSION_COOKIE = 'ema_rt';
const SESSION_COOKIE_PATH = '/api/v1/auth';
const sessionCookieOptions = {
  httpOnly: true,
  secure: isProduction,               // Secure required for SameSite=None
  sameSite: isProduction ? 'none' : 'lax',
  path: SESSION_COOKIE_PATH,
  maxAge: refreshTokenDays * 24 * 60 * 60 * 1000,
};

const setSessionCookie = (res, refreshToken) => {
  if (typeof refreshToken === 'string' && refreshToken) {
    res.cookie(SESSION_COOKIE, refreshToken, sessionCookieOptions);
  }
};

const clearSessionCookie = (res) => {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions, maxAge: undefined });
};

/** Refresh token from body (mobile app) or the HttpOnly cookie (web admin). */
const refreshTokenFrom = (req) =>
  isRefreshToken(req.body?.refreshToken)
    ? req.body.refreshToken
    : (typeof req.cookies?.[SESSION_COOKIE] === 'string' ? req.cookies[SESSION_COOKIE] : null);

const OTP_TYPES = ['REGISTRATION', 'PASSWORD_RESET'];

// Hosts allowed for profile image URLs (Neon Object Storage endpoint).
const ALLOWED_IMAGE_HOSTS = new Set();
try {
  if (storageEndpoint) {
    ALLOWED_IMAGE_HOSTS.add(new URL(storageEndpoint).hostname);
  }
} catch (_e) {
  /* invalid endpoint — allowlist stays empty */
}

/** Profile images: https only, host on the storage allowlist. */
const isAllowedImageUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(url.hostname);
  } catch (_e) {
    return false;
  }
};

// ── strict field validators: strings only, bounded length ────────────────────
const isPhone = (v) => typeof v === 'string' && v.length <= 20;
const isEmail = (v) => typeof v === 'string' && v.length <= 254;
const isFullName = (v) =>
  typeof v === 'string' && v.trim().length >= 2 && v.trim().length <= 80;
const isPassword = (v) => typeof v === 'string' && v.length <= 128;
const isOtpCode = (v) => typeof v === 'string' && /^\d{6}$/.test(v);
const isReferralCode = (v) =>
  typeof v === 'string' && /^[A-Za-z0-9-]{1,32}$/.test(v);
const isRefreshToken = (v) => typeof v === 'string' && v.length <= 200;
const isProfileImage = (v) =>
  typeof v === 'string' && v.length <= 500 && isAllowedImageUrl(v);

/** Returns a trimmed string, or '' if the value is not a string. */
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** Strip control characters from a name. */
const cleanName = (v) => v.replace(/[\x00-\x1F\x7F]/g, '').trim();

// ── POST /api/v1/auth/register ─────────────────────────────────────────────
// Body: { phone, fullName, password, referralCode? }
// → Saves user to DB, sends OTP, returns { message }. The OTP is NEVER returned.
const register = async (req, res, next) => {
  try {
    noStore(res);
    const phone = str(req.body.phone);
    const fullName = cleanName(str(req.body.fullName));
    const password = req.body.password;
    const referralCode = str(req.body.referralCode);

    if (
      !isPhone(phone) ||
      !isFullName(fullName) ||
      !isPassword(password) ||
      (referralCode && !isReferralCode(referralCode))
    )
      return invalidInput(res);

    await service.registerStep1(
      {
        phone,
        fullName,
        password,
        referralCode: referralCode || undefined,
      },
      { req },
    );

    ok(res, { message: 'OTP sent. Please verify your phone number.' });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/register/verify ─────────────────────────────────────
// Body: { phone, code, referralCode? }
// → Verifies OTP, activates account, returns token pair + user
const registerVerify = async (req, res, next) => {
  try {
    noStore(res);
    const phone = str(req.body.phone);
    const code = str(String(req.body.code ?? ''));
    const referralCode = str(req.body.referralCode);

    if (
      !isPhone(phone) ||
      !isOtpCode(code) ||
      (referralCode && !isReferralCode(referralCode))
    )
      return invalidInput(res);

    const result = await service.registerStep2(
      {
        phone,
        code,
        referralCode: referralCode || undefined,
      },
      { req },
    );

    setSessionCookie(res, result.refreshToken);
    created(res, result);
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/login ────────────────────────────────────────────────
// Body: { phone?, email?, password }
// → Returns { accessToken, refreshToken, expiresIn, token, user }
// Supports phone login for customers and email login for admins
const login = async (req, res, next) => {
  try {
    noStore(res);
    const phone = str(req.body.phone);
    const email = str(req.body.email);
    const password = req.body.password; // passed through unchanged — never trim

    if (!isPassword(password)) return invalidInput(res);
    if ((phone && !isPhone(phone)) || (email && !isEmail(email)))
      return invalidInput(res);
    if (!phone && !email)
      return error(res, 'phone or email is required.', 400, 'MISSING_FIELDS');

    const result = await service.login(
      {
        phone: phone || null,
        email: email || null,
        password,
      },
      { req },
    );

    setSessionCookie(res, result.refreshToken);
    ok(res, result);
  } catch (err) {
    // Log only the error code — never phone, email or password.
    console.error('[Auth Login] Failed:', err.code || err.name);
    next(err);
  }
};

// ── POST /api/v1/auth/forgot-password ─────────────────────────────────────
// Body: { phone }
// → Sends reset OTP. Same response whether or not the number is registered.
const forgotPassword = async (req, res, next) => {
  try {
    noStore(res);
    const phone = str(req.body.phone);

    if (!isPhone(phone)) return invalidInput(res);

    await service.forgotPasswordStep1({ phone }, { req });

    ok(res, { message: 'If this number is registered, a reset code has been sent.' });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/forgot-password/verify ──────────────────────────────
// Body: { phone, code }
// → Checks the reset OTP WITHOUT consuming it (the reset call consumes it).
const verifyForgotPassword = async (req, res, next) => {
  try {
    noStore(res);
    const phone = str(req.body.phone);
    const code = str(String(req.body.code ?? ''));

    if (!isPhone(phone) || !isOtpCode(code)) return invalidInput(res);

    await service.verifyOtp(phone, code, 'PASSWORD_RESET', { consume: false });

    ok(res, { verified: true });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/forgot-password/reset ───────────────────────────────
// Body: { phone, code, newPassword }
// → Resets password
const resetPassword = async (req, res, next) => {
  try {
    noStore(res);
    const phone = str(req.body.phone);
    const code = str(String(req.body.code ?? ''));
    const newPassword = req.body.newPassword;

    if (!isPhone(phone) || !isOtpCode(code) || !isPassword(newPassword))
      return invalidInput(res);

    await service.forgotPasswordStep2({ phone, code, newPassword }, { req });

    ok(res, { message: 'Password reset successfully.' });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/resend-otp ──────────────────────────────────────────
// Body: { phone, type }   type: 'REGISTRATION' | 'PASSWORD_RESET'
const resendOtp = async (req, res, next) => {
  try {
    noStore(res);
    const phone = str(req.body.phone);
    const type = str(req.body.type) || 'REGISTRATION';

    if (!isPhone(phone)) return invalidInput(res);
    if (!OTP_TYPES.includes(type))
      return error(res, 'type must be REGISTRATION or PASSWORD_RESET.', 400, 'INVALID_TYPE');

    // One service call for both types: it only sends to real pending / active
    // accounts and answers the same way for every other number.
    await service.resendOtp(phone, type, { req });

    ok(res, { message: 'If the number is valid, a new code has been sent.' });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/refresh ─────────────────────────────────────────────
// Body: { refreshToken } → rotates it, returns a new pair
const refresh = async (req, res, next) => {
  try {
    noStore(res);
    const refreshToken = refreshTokenFrom(req);

    if (!refreshToken) return invalidInput(res);

    const tokens = await tokenService.rotateRefreshToken(refreshToken, req);
    setSessionCookie(res, tokens.refreshToken);
    ok(res, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/logout ──────────────────────────────────────────────
// Body: { refreshToken } → revokes it. Always 200 — no oracle.
const logout = async (req, res, next) => {
  try {
    noStore(res);
    const refreshToken = refreshTokenFrom(req);
    if (refreshToken) {
      await tokenService.revokeRefreshToken(refreshToken);
    }
    clearSessionCookie(res);
    ok(res, { message: 'Logged out.' });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/logout-all ──────────────────────────────────────────
// Requires Bearer access token (requireAuth on the route).
const logoutAll = async (req, res, next) => {
  try {
    noStore(res);
    const userId = req.user?.id;
    if (!userId)
      return error(res, 'Authentication required.', 401, 'UNAUTHORIZED');

    await tokenService.revokeAllForUser(userId);
    clearSessionCookie(res);
    ok(res, { message: 'All sessions revoked.' });
  } catch (err) {
    next(err);
  }
};

// ── PUT /api/v1/auth/profile-image ────────────────────────────────────────
// Body: { profileImage } — https URL on the storage allowlist only
const updateProfileImage = async (req, res, next) => {
  try {
    noStore(res);
    const userId = req.user?.id;
    const profileImage = str(req.body.profileImage);

    if (!userId)
      return error(res, 'Authentication required.', 401, 'UNAUTHORIZED');
    if (!isProfileImage(profileImage)) return invalidInput(res);

    await service.updateProfileImage(userId, profileImage);

    ok(res, { message: 'Profile image updated successfully.' });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/auth/me ───────────────────────────────────────────────────
// Hydrates current authenticated user and verifies active/block status
const getMe = async (req, res, next) => {
  try {
    noStore(res);
    const userId = req.user?.id;
    if (!userId) {
      return error(res, 'Authentication required.', 401, 'UNAUTHORIZED');
    }
    const user = await service.getCurrentUser(userId);
    ok(res, { user });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  register,
  registerVerify,
  login,
  forgotPassword,
  verifyForgotPassword,
  resetPassword,
  resendOtp,
  refresh,
  logout,
  logoutAll,
  updateProfileImage,
  getMe,
};
