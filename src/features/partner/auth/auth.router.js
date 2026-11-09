const { Router } = require('express');
const ctrl = require('./auth.controller');
const { requireAuth, requirePartner } = require('../../../core/middleware/auth');

const router = Router();

router.post('/register',         ctrl.register);
router.post('/register/verify',  ctrl.verifyRegister);
router.post('/login',            ctrl.login);
router.post('/login/verify',     ctrl.verifyLogin);
router.post('/resend-otp',       ctrl.resendOtp);
router.get('/me',                requireAuth, requirePartner, ctrl.getMe);

module.exports = router;
