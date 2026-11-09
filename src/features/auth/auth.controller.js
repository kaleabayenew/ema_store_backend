const service = require('./auth.service');
const tokenService = require('./token.service');
const { ok, created, error } = require('../../core/utils/response');
const { storageEndpoint } = require('../../core/config');

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

    if (type === 'PASSWORD_RESET') {
      // Goes through the same check as forgot-password (active accounts only)
      await service.forgotPasswordStep1({ phone }, { req });
    } else {
      await service.sendOtp(phone, type, { req });
    }

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
    const refreshToken = req.body.refreshToken;

    if (!isRefreshToken(refreshToken)) return invalidInput(res);

    const tokens = await tokenService.rotateRefreshToken(refreshToken, req);
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
    const refreshToken = req.body.refreshToken;
    if (isRefreshToken(refreshToken)) {
      await tokenService.revokeRefreshToken(refreshToken);
    }
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
  resetPassword,
  resendOtp,
  refresh,
  logout,
  logoutAll,
  updateProfileImage,
  getMe,
};
