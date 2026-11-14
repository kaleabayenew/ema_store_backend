const { Router } = require('express');
const { getAppVersion, submitRelease } = require('./app-update.controller');
const { requireAuth, requireStaff } = require('../../core/middleware/auth');

const router = Router();

// Public endpoint to check for client updates
router.get('/', getAppVersion);

// Staff-only: submitting a release pings the owner on Telegram — an open
// endpoint would let anyone spam approvals or push a malicious APK link.
router.post('/submit', requireAuth, requireStaff, submitRelease);

module.exports = router;
