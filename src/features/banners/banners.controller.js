const { ok, created, error } = require('../../core/utils/response');
const { pool } = require('../../core/config/database');

// GET /api/v1/banners/payment - Get active payment banner
const getPaymentBanner = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM payment_banners
      WHERE is_active = true
      AND (valid_from IS NULL OR valid_from <= NOW())
      AND (valid_until IS NULL OR valid_until > NOW())
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (rows.length === 0) {
      return ok(res, { banner: null });
    }

    ok(res, { banner: rows[0] });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/banners/payment - Create payment banner (admin)
const createPaymentBanner = async (req, res, next) => {
  try {
    const { title, description, image_url, valid_from, valid_until, redirect_url } = req.body;

    const { rows } = await pool.query(`
      INSERT INTO payment_banners (title, description, image_url, valid_from, valid_until, redirect_url, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING *
    `, [title, description, image_url, valid_from, valid_until, redirect_url]);

    created(res, rows[0]);
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/banners/payment/all - Get all payment banners (admin)
const getAllPaymentBanners = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM payment_banners
      ORDER BY created_at DESC
    `);

    ok(res, { banners: rows });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/banners/payment/:id - Update payment banner (admin)
const updatePaymentBanner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, image_url, valid_from, valid_until, redirect_url, is_active } = req.body;

    const { rows } = await pool.query(`
      UPDATE payment_banners
      SET title = COALESCE($1, title),
          description = COALESCE($2, description),
          image_url = COALESCE($3, image_url),
          valid_from = COALESCE($4, valid_from),
          valid_until = COALESCE($5, valid_until),
          redirect_url = COALESCE($6, redirect_url),
          is_active = COALESCE($7, is_active),
          updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `, [title, description, image_url, valid_from, valid_until, redirect_url, is_active, id]);

    if (rows.length === 0) {
      return error(res, 'Banner not found', 404, 'NOT_FOUND');
    }

    ok(res, { banner: rows[0] });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/banners/payment/:id - Delete payment banner (admin)
const deletePaymentBanner = async (req, res, next) => {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM payment_banners WHERE id = $1', [id]);

    ok(res, { message: 'Banner deleted successfully' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPaymentBanner,
  createPaymentBanner,
  getAllPaymentBanners,
  updatePaymentBanner,
  deletePaymentBanner,
};
