const { sendOtp } = require('../../core/services/telegram-bot.service');
const { pool } = require('../../core/config/database');

// ─────────────────────────────────────────────────────────────────────────────
//  Link Telegram Chat ID to Phone Number
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/telegram/link
 * Links a Telegram chat ID to a phone number
 * This endpoint is called by the Telegram bot webhook
 */
async function linkTelegram(req, res) {
  const { phone, chat_id, username } = req.body;

  if (!phone || !chat_id) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_FIELDS',
      message: 'Phone and chat_id are required',
    });
  }

  try {
    // Normalize phone number
    const canonicalPhone = phone.replace(/\D/g, '');
    const normalizedPhone = canonicalPhone.startsWith('251')
      ? `+${canonicalPhone}`
      : canonicalPhone.startsWith('0')
      ? `+251${canonicalPhone.substring(1)}`
      : `+251${canonicalPhone}`;

    // Check if already linked
    const { rows } = await pool.query(
      'SELECT id FROM telegram_chat_ids WHERE phone = $1',
      [normalizedPhone],
    );

    if (rows.length > 0) {
      // Update existing
      await pool.query(
        'UPDATE telegram_chat_ids SET chat_id = $1, username = $2, updated_at = NOW() WHERE phone = $3',
        [chat_id, username || null, normalizedPhone],
      );
    } else {
      // Insert new
      await pool.query(
        'INSERT INTO telegram_chat_ids (phone, chat_id, username) VALUES ($1, $2, $3)',
        [normalizedPhone, chat_id, username || null],
      );
    }

    res.json({
      success: true,
      message: 'Telegram chat ID linked successfully',
    });
  } catch (error) {
    console.error('[Telegram] Link error:', error);
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to link Telegram chat ID',
    });
  }
}

module.exports = {
  linkTelegram,
};
