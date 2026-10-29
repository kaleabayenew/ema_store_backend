const service  = require('./auth.service');
const { ok, created, error } = require('../../core/utils/response');

// ── POST /api/v1/auth/register ─────────────────────────────────────────────
// Body: { phone, fullName, password }
// → Saves user to DB, sends OTP, returns { message }
const register = async (req, res, next) => {
  try {
    const { phone, fullName, password } = req.body;

    if (!phone || !fullName || !password)
      return error(res, 'phone, fullName and password are required.', 400, 'MISSING_FIELDS');

    const otp = await service.registerStep1({ phone: phone.trim(), fullName, password });

    ok(res, {
      message: 'OTP sent. Please verify your phone number.',
      otp,
    });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/register/verify ─────────────────────────────────────
// Body: { phone, code }
// → Verifies OTP, activates account, returns { token, user }
const registerVerify = async (req, res, next) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code)
      return error(res, 'phone and code are required.', 400, 'MISSING_FIELDS');

    const result = await service.registerStep2({ phone: phone.trim(), code: code.trim() });

    created(res, result);
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/login ────────────────────────────────────────────────
// Body: { phone?, email?, password }
// → Returns { token, user }
// Supports phone login for customers and email login for admins
const login = async (req, res, next) => {
  try {
    const { phone, email, password } = req.body;

    if (!password)
      return error(res, 'password is required.', 400, 'MISSING_FIELDS');
    if (!phone && !email)
      return error(res, 'phone or email is required.', 400, 'MISSING_FIELDS');

    const result = await service.login({
      phone: phone ? phone.trim() : null,
      email: email ? email.trim() : null,
      password,
    });

    ok(res, result);
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/forgot-password ─────────────────────────────────────
// Body: { phone }
// → Sends reset OTP
const forgotPassword = async (req, res, next) => {
  try {
    const { phone } = req.body;

    if (!phone)
      return error(res, 'phone is required.', 400, 'MISSING_FIELDS');

    await service.forgotPasswordStep1({ phone: phone.trim() });

    ok(res, { message: 'Reset OTP sent to your number.' });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/forgot-password/reset ───────────────────────────────
// Body: { phone, code, newPassword }
// → Resets password
const resetPassword = async (req, res, next) => {
  try {
    const { phone, code, newPassword } = req.body;

    if (!phone || !code || !newPassword)
      return error(res, 'phone, code and newPassword are required.', 400, 'MISSING_FIELDS');

    await service.forgotPasswordStep2({
      phone: phone.trim(),
      code:  code.trim(),
      newPassword,
    });

    ok(res, { message: 'Password reset successfully.' });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/auth/resend-otp ──────────────────────────────────────────
// Body: { phone, type }   type: 'REGISTRATION' | 'PASSWORD_RESET'
const resendOtp = async (req, res, next) => {
  try {
    const { phone, type = 'REGISTRATION' } = req.body;

    if (!phone)
      return error(res, 'phone is required.', 400, 'MISSING_FIELDS');

    await service.sendOtp(phone.trim(), type);

    ok(res, { message: 'OTP resent.' });
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
};
