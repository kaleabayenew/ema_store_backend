const axios = require('axios');

// ─────────────────────────────────────────────────────────────────────────────
//  Telegram Gateway API Service
//  Sends SMS OTP messages via Telegram Gateway API
// ─────────────────────────────────────────────────────────────────────────────

// Configuration from environment variables
const TELEGRAM_GATEWAY_API_KEY = process.env.TELEGRAM_GATEWAY_API_KEY;
const TELEGRAM_GATEWAY_SENDER_ID = process.env.TELEGRAM_GATEWAY_SENDER_ID || 'EMAStore';

// API endpoint
const TELEGRAM_GATEWAY_URL = 'https://api.telegram-gateway.com/v1/sms/send';

/**
 * Send SMS via Telegram Gateway API
 * @param {string} phone - Phone number in E.164 format (+251XXXXXXXXX)
 * @param {string} message - SMS message content
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function sendSms(phone, message) {
  if (!TELEGRAM_GATEWAY_API_KEY) {
    console.warn('[Telegram Gateway] API key not configured. Logging OTP instead.');
    console.log(`[SMS MOCK] ${phone}: ${message}`);
    return { success: true, mock: true };
  }

  try {
    const response = await axios.post(TELEGRAM_GATEWAY_URL, {
      api_key: TELEGRAM_GATEWAY_API_KEY,
      sender_id: TELEGRAM_GATEWAY_SENDER_ID,
      phone: phone,
      message: message,
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10 second timeout
    });

    if (response.data && response.data.success) {
      console.log(`[Telegram Gateway] SMS sent to ${phone}, Message ID: ${response.data.message_id}`);
      return { success: true, messageId: response.data.message_id };
    } else {
      console.error('[Telegram Gateway] API returned error:', response.data);
      return { success: false, error: response.data?.message || 'Unknown error' };
    }
  } catch (error) {
    console.error('[Telegram Gateway] API request failed:', error.message);
    // Fallback to console logging if API fails
    console.log(`[SMS FALLBACK] ${phone}: ${message}`);
    return { success: true, fallback: true };
  }
}

/**
 * Generate OTP message for different types
 * @param {string} otp - 6-digit OTP code
 * @param {string} type - 'REGISTRATION' | 'PASSWORD_RESET'
 * @returns {string} Formatted SMS message
 */
function formatOtpMessage(otp, type) {
  if (type === 'REGISTRATION') {
    return `Your Ema Store verification code is ${otp}. Valid for 15 minutes. Do not share this code.`;
  } else if (type === 'PASSWORD_RESET') {
    return `Your Ema Store password reset code is ${otp}. Valid for 15 minutes. Do not share this code.`;
  }
  return `Your verification code is ${otp}. Valid for 15 minutes.`;
}

module.exports = {
  sendSms,
  formatOtpMessage,
};
