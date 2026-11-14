const TelegramBot = require('node-telegram-bot-api');

// ─────────────────────────────────────────────────────────────────────────────
//  Telegram Bot Service
//  Sends OTP codes via Telegram Bot (Free)
//  Documentation: https://core.telegram.org/bots/api
//
//  SECURITY: OTP codes, passwords and the bot token must NEVER appear in logs.
//  Failures are reported honestly ({ success: false }) so callers know the
//  message was not delivered.
// ─────────────────────────────────────────────────────────────────────────────

// Configuration from environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Create bot instance (only if token is available)
let bot = null;
if (TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
}

const SEND_TIMEOUT_MS = 8_000;

/** chatId: non-empty string/number of digits (optional leading "-"), max 20 chars. */
const isValidChatId = (chatId) =>
  (typeof chatId === 'string' || typeof chatId === 'number') &&
  /^-?\d{1,20}$/.test(String(chatId));

/** Mask a chat id for logs: only the last 4 digits are shown. */
const maskChatId = (chatId) => `***${String(chatId).slice(-4)}`;

/** Log only the error type — never error.response bodies or secrets. */
const logSendFailure = (chatId, error) => {
  const type = (error && (error.code || error.name)) || 'UNKNOWN';
  console.error(`[Telegram Bot] send failed (${type}) chat ${maskChatId(chatId)}`);
};

/** sendMessage with an 8s timeout so a hanging call cannot block a login. */
async function sendWithTimeout(chatId, message, options) {
  let timer;
  try {
    return await Promise.race([
      bot.sendMessage(chatId, message, options),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error('Telegram send timed out');
          err.code = 'ETIMEOUT';
          reject(err);
        }, SEND_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send OTP via Telegram Bot
 * @param {string} chatId - Telegram chat ID of the user
 * @param {string} otp - OTP code
 * @param {string} type - 'REGISTRATION' | 'PASSWORD_RESET'
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function sendOtp(chatId, otp, type = 'REGISTRATION') {
  if (!isValidChatId(chatId) || !/^\d{6}$/.test(String(otp))) {
    return { success: false, error: 'INVALID_INPUT' };
  }

  if (!bot) {
    // No secret is logged; dev OTPs are printed by auth.service.js instead.
    console.error('[Telegram Bot] send failed (BOT_NOT_CONFIGURED)');
    return { success: false, error: 'BOT_NOT_CONFIGURED' };
  }

  try {
    const message = type === 'REGISTRATION'
      ? `🔐 *Ema Store Verification*\n\nYour verification code is: *${otp}*\n\nValid for 15 minutes. Do not share this code.`
      : `🔐 *Ema Store Password Reset*\n\nYour reset code is: *${otp}*\n\nValid for 15 minutes. Do not share this code.`;

    await sendWithTimeout(chatId, message, { parse_mode: 'Markdown' });
    return { success: true };
  } catch (error) {
    logSendFailure(chatId, error);
    return { success: false, error: 'DELIVERY_FAILED' };
  }
}

/**
 * Send a new/reset password to a customer via Telegram Bot
 * @param {string} chatId - Telegram chat ID of the user
 * @param {string} phone  - Customer phone (for context in the message)
 * @param {string} newPassword
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function sendPasswordReset(chatId, phone, newPassword) {
  if (!isValidChatId(chatId)) {
    return { success: false, error: 'INVALID_INPUT' };
  }

  if (!bot) {
    console.error('[Telegram Bot] send failed (BOT_NOT_CONFIGURED)');
    return { success: false, error: 'BOT_NOT_CONFIGURED' };
  }

  try {
    const message =
      `🔑 *Ema Store — Password Reset*\n\n` +
      `Your account password has been reset by our support team.\n\n` +
      `*New password:* \`${newPassword}\`\n\n` +
      `Please log in and change it from your profile settings.\n` +
      `Do not share this password with anyone.`;

    await sendWithTimeout(chatId, message, { parse_mode: 'Markdown' });
    return { success: true };
  } catch (error) {
    logSendFailure(chatId, error);
    return { success: false, error: 'DELIVERY_FAILED' };
  }
}

/** Escape Telegram Markdown special chars in user/admin-supplied text. */
const escapeMd = (s) =>
  String(s).replace(/([_*`[\]])/g, '\\$1');

/**
 * Send an admin announcement broadcast to a linked Telegram chat.
 * @param {string} chatId
 * @param {string} title
 * @param {string} body
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function sendAnnouncement(chatId, title, body) {
  if (!isValidChatId(chatId)) {
    return { success: false, error: 'INVALID_INPUT' };
  }

  if (!bot) {
    console.error('[Telegram Bot] announcement send failed (BOT_NOT_CONFIGURED)');
    return { success: false, error: 'BOT_NOT_CONFIGURED' };
  }

  try {
    const message = `📢 *${escapeMd(title)}*\n\n${escapeMd(body)}`;
    await sendWithTimeout(chatId, message, { parse_mode: 'Markdown' });
    return { success: true };
  } catch (error) {
    logSendFailure(chatId, error);
    return { success: false, error: 'DELIVERY_FAILED' };
  }
}

/**
 * Verify the bot token is valid
 * @returns {Promise<boolean>}
 */
async function verifyBot() {
  if (!bot) {
    console.warn('[Telegram Bot] Bot token not configured');
    return false;
  }

  try {
    const botInfo = await bot.getMe();
    console.log(`[Telegram Bot] Bot verified: @${botInfo.username}`);
    return true;
  } catch (error) {
    const type = (error && (error.code || error.name)) || 'UNKNOWN';
    console.error(`[Telegram Bot] Verification failed (${type})`);
    return false;
  }
}

module.exports = {
  sendOtp,
  sendPasswordReset,
  sendAnnouncement,
  verifyBot,
};
