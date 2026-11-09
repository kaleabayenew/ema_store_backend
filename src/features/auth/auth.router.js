const { Router } = require('express');
const ctrl = require('./auth.controller');
const { requireAuth } = require('../../core/middleware/auth');
const { AppError } = require('../../core/errors/app_error');
const {
  loginLimiter,
  loginIpLimiter,
  otpSendLimiter,
  otpSendIpLimiter,
  otpVerifyLimiter,
  refreshLimiter,
} = require('../../core/middleware/rate_limiter');

const router = Router();

// Registration
router.post('/register',        otpSendIpLimiter, otpSendLimiter, ctrl.register);
router.post('/register/verify', otpVerifyLimiter, ctrl.registerVerify);

// Login
router.post('/login', loginIpLimiter, loginLimiter, ctrl.login);

// Forgot password
router.post('/forgot-password',       otpSendIpLimiter, otpSendLimiter, ctrl.forgotPassword);
router.post('/forgot-password/reset', otpVerifyLimiter, ctrl.resetPassword);

// Resend OTP
router.post('/resend-otp', otpSendIpLimiter, otpSendLimiter, ctrl.resendOtp);

// Token lifecycle
router.post('/refresh',     refreshLimiter, ctrl.refresh);
router.post('/logout',      refreshLimiter, ctrl.logout);
router.post('/logout-all',  requireAuth, refreshLimiter, ctrl.logoutAll);

// Current user profile & status check
router.get('/me', requireAuth, ctrl.getMe);

// Profile image update (requires authentication)
router.put('/profile-image', requireAuth, ctrl.updateProfileImage);

// Catch-all: unsupported methods on these paths get 405, not a fallthrough.
const AUTH_PATHS = [
  '/register',
  '/register/verify',
  '/login',
  '/forgot-password',
  '/forgot-password/reset',
  '/resend-otp',
  '/refresh',
  '/logout',
  '/logout-all',
  '/me',
  '/profile-image',
];
router.all(AUTH_PATHS, (_req, _res, next) =>
  next(new AppError('Method not allowed.', 405, 'METHOD_NOT_ALLOWED')),
);

module.exports = router;
