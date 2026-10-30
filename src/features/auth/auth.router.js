const { Router } = require('express');
const ctrl = require('./auth.controller');

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

module.exports = router;
