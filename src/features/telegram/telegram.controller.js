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

    // Check if phone is already linked to a different chat ID
    const { rows } = await pool.query(
      'SELECT chat_id, username FROM telegram_chat_ids WHERE phone = $1',
      [normalizedPhone],
    );

    if (rows.length > 0) {
      const existingChatId = rows[0].chat_id;
      const existingUsername = rows[0].username;
      
      // If linked to the same chat ID, just update username
      if (existingChatId === chat_id) {
        await pool.query(
          'UPDATE telegram_chat_ids SET username = $2, updated_at = NOW() WHERE phone = $1',
          [normalizedPhone, username || null],
        );
        return res.json({
          success: true,
          message: 'Telegram account updated successfully',
        });
      }
      
      // If linked to a different chat ID, warn the user
      return res.status(409).json({
        success: false,
        code: 'PHONE_ALREADY_LINKED',
        message: 'This phone number is already linked to a different Telegram account. Please use the same Telegram account that you originally registered with.',
        existing_username: existingUsername,
      });
    }

    // Insert new
    await pool.query(
      'INSERT INTO telegram_chat_ids (phone, chat_id, username) VALUES ($1, $2, $3)',
      [normalizedPhone, chat_id, username || null],
    );

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

/**
 * GET /api/v1/telegram/check/:chatId
 * Checks if a chat ID has a linked phone number
 */
async function checkLink(req, res) {
  const { chatId } = req.params;

  if (!chatId) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_CHAT_ID',
      message: 'Chat ID is required',
    });
  }

  try {
    const { rows } = await pool.query(
      'SELECT phone FROM telegram_chat_ids WHERE chat_id = $1',
      [chatId],
    );

    if (rows.length > 0) {
      res.json({
        success: true,
        phone: rows[0].phone,
      });
    } else {
      res.json({
        success: false,
        phone: null,
      });
    }
  } catch (error) {
    console.error('[Telegram] Check error:', error);
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to check Telegram link',
    });
  }
}

module.exports = {
  linkTelegram,
  checkLink,
};
