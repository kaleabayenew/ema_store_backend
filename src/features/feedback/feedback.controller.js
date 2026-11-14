const { ok, created, error } = require('../../core/utils/response');
const { pool } = require('../../core/config/database');
const { requireAuth } = require('../../core/middleware/auth');

// POST /api/v1/feedback — submit feedback (authenticated users)
const submitFeedback = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return error(res, 'Authentication required', 401, 'UNAUTHORIZED');

    const { message, rating } = req.body || {};
    const text = String(message || '').trim();
    if (!text) return error(res, 'Message is required', 400, 'MESSAGE_REQUIRED');
    if (text.length > 2000) return error(res, 'Message too long (max 2000 chars)', 400, 'MESSAGE_TOO_LONG');

    const ratingValue = rating != null ? Math.min(5, Math.max(1, parseInt(rating, 10) || 0)) : null;

    const { rows } = await pool.query(`
      INSERT INTO feedback (user_id, message, rating, status)
      VALUES ($1, $2, $3, 'NEW')
      RETURNING id, message, rating, status, created_at
    `, [userId, text, ratingValue]);

    created(res, rows[0]);
  } catch (err) {
    next(err);
  }
};

module.exports = { submitFeedback };
