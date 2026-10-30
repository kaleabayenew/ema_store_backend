const express = require('express');
const router = express.Router();
const { linkTelegram } = require('./telegram.controller');

// POST /api/v1/telegram/link - Link Telegram chat ID to phone number
router.post('/link', linkTelegram);

module.exports = router;
