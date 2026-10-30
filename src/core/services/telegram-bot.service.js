const TelegramBot = require('node-telegram-bot-api');

// ─────────────────────────────────────────────────────────────────────────────
//  Telegram Bot Service
//  Sends OTP codes via Telegram Bot (Free)
//  Documentation: https://core.telegram.org/bots/api
// ─────────────────────────────────────────────────────────────────────────────

// Configuration from environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Create bot instance (only if token is available)
let bot = null;
if (TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
}

/**
 * Send OTP via Telegram Bot
 * @param {string} chatId - Telegram chat ID of the user
 * @param {string} otp - OTP code
 * @param {string} type - 'REGISTRATION' | 'PASSWORD_RESET'
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function sendOtp(chatId, otp, type = 'REGISTRATION') {
  if (!bot) {
    console.warn('[Telegram Bot] Bot token not configured. Logging OTP instead.');
    console.log(`[SMS MOCK] Chat ID ${chatId}: OTP ${otp}`);
    return { success: true, mock: true };
  }

  if (!chatId) {
    console.error('[Telegram Bot] Chat ID is required');
    return { success: false, error: 'Chat ID is required' };
  }

  try {
    const message = type === 'REGISTRATION'
      ? `🔐 *Ema Store Verification*\n\nYour verification code is: *${otp}*\n\nValid for 15 minutes. Do not share this code.`
      : `🔐 *Ema Store Password Reset*\n\nYour reset code is: *${otp}*\n\nValid for 15 minutes. Do not share this code.`;

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    console.log(`[Telegram Bot] OTP sent to chat ${chatId}: ${otp}`);
    return { success: true };
  } catch (error) {
    console.error('[Telegram Bot] API request failed:', error.message);
    // Fallback to console logging if API fails
    console.log(`[SMS FALLBACK] Chat ID ${chatId}: OTP ${otp}`);
    return { success: true, fallback: true };
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
    console.error('[Telegram Bot] Verification failed:', error.message);
    return false;
  }
}

module.exports = {
  sendOtp,
  verifyBot,
};
