const { pool } = require('../../core/config/database');
const { normalizePhone } = require('../auth/auth.service');

// ─────────────────────────────────────────────────────────────────────────────
//  Telegram linking — called ONLY by our own bot (x-bot-key, see routes file).
//  The bot sends a phone number that Telegram itself confirmed belongs to the
//  chat (contact sharing), so this controller only validates and stores it.
// ─────────────────────────────────────────────────────────────────────────────

const PHONE_RE = /^\+251[79]\d{8}$/;
const CHAT_ID_RE = /^-?\d{1,20}$/;

const bad = (res, code, message) =>
  res.status(400).json({ success: false, code, message });

/**
 * POST /api/v1/telegram/link
 * Body: { phone, chat_id, username? }
 */
async function linkTelegram(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { phone, chat_id: rawChatId, username: rawUsername } = body;

  if (phone === undefined || phone === null || rawChatId === undefined || rawChatId === null) {
    return bad(res, 'MISSING_FIELDS', 'Phone and chat_id are required');
  }

  // Strict types: never trust the shape of a request body.
  if (typeof phone !== 'string' || phone.length > 20) {
    return bad(res, 'INVALID_INPUT', 'Invalid input.');
  }
  if (
    (typeof rawChatId !== 'string' && typeof rawChatId !== 'number') ||
    !CHAT_ID_RE.test(String(rawChatId))
  ) {
    return bad(res, 'INVALID_INPUT', 'Invalid input.');
  }
  let username = null;
  if (rawUsername !== undefined && rawUsername !== null && rawUsername !== '') {
    if (typeof rawUsername !== 'string' || rawUsername.length > 64) {
      return bad(res, 'INVALID_INPUT', 'Invalid input.');
    }
    username = rawUsername;
  }

  // Same canonical format the login uses, so OTP lookups always match.
  const normalizedPhone = normalizePhone(phone);
  if (!PHONE_RE.test(normalizedPhone)) {
    return bad(res, 'INVALID_PHONE', 'Invalid phone number.');
  }

  // chat_id is BIGINT: pg returns it as a STRING, so always compare strings.
  const chatId = String(rawChatId);

  try {
    // Race-safe: the unique constraint on phone decides who wins.
    const inserted = await pool.query(
      `INSERT INTO telegram_chat_ids (phone, chat_id, username)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO NOTHING
       RETURNING chat_id`,
      [normalizedPhone, chatId, username],
    );
    if (inserted.rows.length > 0) {
      return res.json({ success: true, message: 'Telegram chat ID linked successfully' });
    }

    const { rows } = await pool.query(
      'SELECT chat_id FROM telegram_chat_ids WHERE phone = $1',
      [normalizedPhone],
    );

    // Same Telegram account linking again → just refresh the username.
    if (rows.length > 0 && String(rows[0].chat_id) === chatId) {
      await pool.query(
        'UPDATE telegram_chat_ids SET username = $2, updated_at = NOW() WHERE phone = $1',
        [normalizedPhone, username],
      );
      return res.json({ success: true, message: 'Telegram account updated successfully' });
    }

    // Different Telegram account → refuse, and never say whose it is.
    return res.status(409).json({
      success: false,
      code: 'PHONE_ALREADY_LINKED',
      message:
        'This phone number is already linked to a different Telegram account. Please use the Telegram account you originally used.',
    });
  } catch (error) {
    console.error('[Telegram] Link error:', error.code || error.name);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to link Telegram chat ID',
    });
  }
}

/**
 * GET /api/v1/telegram/check/:chatId   (bot-only, protected by x-bot-key)
 * The bot shows a MASKED phone to the user, so the phone is still returned
 * here — but only ever to the bot, never to the public.
 */
async function checkLink(req, res) {
  const chatId = String(req.params.chatId || '');

  if (!CHAT_ID_RE.test(chatId)) {
    return bad(res, 'INVALID_CHAT_ID', 'Invalid chat ID.');
  }

  try {
    const { rows } = await pool.query(
      'SELECT phone FROM telegram_chat_ids WHERE chat_id = $1',
      [chatId],
    );

    if (rows.length > 0) {
      return res.json({ success: true, phone: rows[0].phone });
    }
    return res.json({ success: false, phone: null });
  } catch (error) {
    console.error('[Telegram] Check error:', error.code || error.name);
    return res.status(500).json({
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
