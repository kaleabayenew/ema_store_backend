const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');

// Ensure reply_text column exists
async function ensureSchema() {
  await pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reply_text TEXT`);
}
ensureSchema().catch(err => console.warn('[Partner Reviews] Schema init:', err.message));

async function getReviews(partnerId, { page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;

  const [countRes, rowsRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM reviews
       JOIN products ON products.id = reviews.product_id
       WHERE products.partner_id = $1`,
      [partnerId],
    ),
    pool.query(
      `SELECT reviews.*, products.name_en, COALESCE(users.full_name, users.phone, 'Customer') AS customer_name
       FROM reviews
       JOIN products ON products.id = reviews.product_id
       LEFT JOIN users ON users.id = COALESCE(reviews.customer_id, reviews.user_id)
       WHERE products.partner_id = $1
       ORDER BY reviews.created_at DESC
       LIMIT $2 OFFSET $3`,
      [partnerId, limit, offset],
    ),
  ]);

  return { reviews: rowsRes.rows, total: countRes.rows[0]?.total ?? 0, page, limit };
}

async function replyToReview(partnerId, reviewId, replyText) {
  // Verify the review's product belongs to this partner
  const { rows: checkRows } = await pool.query(
    `SELECT reviews.id
     FROM reviews
     JOIN products ON products.id = reviews.product_id
     WHERE reviews.id = $1 AND products.partner_id = $2`,
    [reviewId, partnerId],
  );
  if (checkRows.length === 0) throw new AppError('Review not found.', 404, 'REVIEW_NOT_FOUND');

  const { rows } = await pool.query(
    `UPDATE reviews SET reply_text = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [replyText, reviewId],
  );
  return rows[0];
}

module.exports = { getReviews, replyToReview };
