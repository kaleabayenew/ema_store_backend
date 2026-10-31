const { Router } = require('express');
const ctrl = require('./auth.controller');
const { requireAuth } = require('../../core/middleware/auth');

const router = Router();

// Registration
router.post('/register',         ctrl.register);
router.post('/register/verify',  ctrl.registerVerify);

// Login
router.post('/login',            ctrl.login);

// Forgot password
router.post('/forgot-password',       ctrl.forgotPassword);
router.post('/forgot-password/reset', ctrl.resetPassword);

// Resend OTP
router.post('/resend-otp', ctrl.resendOtp);

// Profile image update (requires authentication)
router.put('/profile-image', requireAuth, ctrl.updateProfileImage);

module.exports = router;
