const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { linkTelegram, checkLink } = require('./telegram.controller');
const { createRateLimiter } = require('../../core/middleware/rate_limiter');

// These routes are bot-only. Rate limit first so key guessing is also limited.
const botLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many requests. Please try again later.',
  code: 'RATE_LIMITED',
});

/**
 * requireBotKey — only our own Telegram bot server may call these routes.
 * Fails closed: if TELEGRAM_BOT_API_KEY is missing/too short, everything is 503.
 */
const requireBotKey = (req, res, next) => {
  const expected = process.env.TELEGRAM_BOT_API_KEY;
  if (typeof expected !== 'string' || expected.length < 32) {
    return res.status(503).json({
      success: false,
      code: 'BOT_KEY_NOT_CONFIGURED',
      message: 'Service unavailable.',
    });
  }

  const provided = req.get('x-bot-key') || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_BOT_KEY',
      message: 'Unauthorized.',
    });
  }
  next();
};

/** chatId must be digits with an optional leading "-", max 20 chars. */
const validChatId = /^-?\d{1,20}$/;

const validateChatId = (req, res, next) => {
  if (!validChatId.test(req.params.chatId)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_CHAT_ID',
      message: 'Invalid chat ID.',
    });
  }
  next();
};

// POST /api/v1/telegram/link - Link Telegram chat ID to phone number
router.post('/link', botLimiter, requireBotKey, linkTelegram);

// GET /api/v1/telegram/check/:chatId - Check if chat ID has linked phone
router.get('/check/:chatId', botLimiter, requireBotKey, validateChatId, checkLink);

module.exports = router;
