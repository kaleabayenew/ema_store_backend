const express = require('express');
const router = express.Router();
const { linkTelegram, checkLink } = require('./telegram.controller');

// POST /api/v1/telegram/link - Link Telegram chat ID to phone number
router.post('/link', linkTelegram);

// GET /api/v1/telegram/check/:chatId - Check if chat ID has linked phone
router.get('/check/:chatId', checkLink);

module.exports = router;
