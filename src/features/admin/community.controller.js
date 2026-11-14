const { ok, error } = require('../../core/utils/response');
const { pool } = require('../../core/config/database');

// ── Reviews ──────────────────────────────────────────────────────────────────

// GET /api/v1/admin/reviews
const getAllReviews = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.id, r.rating, r.comment, r.is_approved, r.helpful_count,
             r.created_at, r.updated_at,
             p.id AS product_id, p.name_en AS product_name,
             u.id AS customer_id, u.full_name AS customer_name, u.email AS customer_email
      FROM reviews r
      LEFT JOIN products p ON p.id = r.product_id
      LEFT JOIN users u ON u.id = r.customer_id
      ORDER BY r.created_at DESC
      LIMIT 500
    `);
    ok(res, { reviews: rows });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/admin/reviews/:id — { is_approved }
const updateReview = async (req, res, next) => {
  try {
    const { is_approved } = req.body || {};
    if (typeof is_approved !== 'boolean') {
      return error(res, 'is_approved (boolean) is required', 400, 'INVALID_BODY');
    }
    const { rows } = await pool.query(
      `UPDATE reviews SET is_approved = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
      [is_approved, req.params.id]);
    if (!rows[0]) return error(res, 'Review not found', 404, 'NOT_FOUND');
    ok(res, { updated: true });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/admin/reviews/:id
const deleteReview = async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM reviews WHERE id = $1`, [req.params.id]);
    if (!rowCount) return error(res, 'Review not found', 404, 'NOT_FOUND');
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
};

// ── Feedback ─────────────────────────────────────────────────────────────────

// GET /api/v1/admin/feedback
const getAllFeedback = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT f.id, f.message, f.rating, f.status, f.created_at,
             u.id AS user_id, u.full_name AS user_name, u.email AS user_email, u.phone AS user_phone
      FROM feedback f
      LEFT JOIN users u ON u.id = f.user_id
      ORDER BY f.created_at DESC
      LIMIT 500
    `);
    ok(res, { feedback: rows });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/admin/feedback/:id — { status: 'NEW' | 'IN_PROGRESS' | 'RESOLVED' }
const updateFeedbackStatus = async (req, res, next) => {
  try {
    const status = String(req.body?.status || '').toUpperCase();
    if (!['NEW', 'IN_PROGRESS', 'RESOLVED'].includes(status)) {
      return error(res, 'Invalid status', 400, 'INVALID_STATUS');
    }
    const { rows } = await pool.query(
      `UPDATE feedback SET status = $1 WHERE id = $2 RETURNING id`,
      [status, req.params.id]);
    if (!rows[0]) return error(res, 'Feedback not found', 404, 'NOT_FOUND');
    ok(res, { updated: true });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/admin/feedback/:id
const deleteFeedback = async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM feedback WHERE id = $1`, [req.params.id]);
    if (!rowCount) return error(res, 'Feedback not found', 404, 'NOT_FOUND');
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllReviews, updateReview, deleteReview,
  getAllFeedback, updateFeedbackStatus, deleteFeedback,
};
