const { Router } = require('express');
const ctrl = require('./auth.controller');
const { requireAuth, requirePartner } = require('../../../core/middleware/auth');
const {
  loginLimiter,
  loginIpLimiter,
  otpSendLimiter,
  otpSendIpLimiter,
  otpVerifyLimiter,
} = require('../../../core/middleware/rate_limiter');

const router = Router();

router.post('/register',         otpSendLimiter, otpSendIpLimiter, ctrl.register);
router.post('/register/verify',  otpVerifyLimiter, ctrl.verifyRegister);
router.post('/login',            loginIpLimiter, loginLimiter, ctrl.login);
router.post('/login/password',   loginIpLimiter, loginLimiter, ctrl.loginWithPassword);
router.post('/login/verify',     otpVerifyLimiter, ctrl.verifyLogin);
router.post('/resend-otp',       otpSendLimiter, otpSendIpLimiter, ctrl.resendOtp);
router.get('/me',                requireAuth, requirePartner, ctrl.getMe);

module.exports = router;
