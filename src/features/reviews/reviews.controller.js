const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

const MAX_TITLE = 120;
const MAX_BODY = 2000;

function validateReviewInput({ productId, rating, title, body }) {
  if (!productId || typeof productId !== 'string' || productId.length > 64) {
    throw new AppError('A valid productId is required', 400, 'INVALID_PRODUCT');
  }
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) {
    throw new AppError('Rating must be between 1 and 5', 400, 'INVALID_RATING');
  }
  const t = String(title || '').trim();
  const b = String(body || '').trim();
  if (t.length > MAX_TITLE) {
    throw new AppError(`Title must be at most ${MAX_TITLE} characters`, 400, 'TITLE_TOO_LONG');
  }
  if (b.length > MAX_BODY) {
    throw new AppError(`Review must be at most ${MAX_BODY} characters`, 400, 'BODY_TOO_LONG');
  }
  if (!b) {
    throw new AppError('Review text is required', 400, 'BODY_REQUIRED');
  }
  // Real schema has a single `comment` column — store "title\nbody".
  const comment = t ? `${t}\n${b}` : b;
  return { productId, rating: r, title: t, body: b, comment };
}

function mapReview(r) {
  // Split stored comment back into title/body for the app contract.
  const raw = String(r.comment || '');
  const nl = raw.indexOf('\n');
  const title = nl >= 0 ? raw.slice(0, nl) : '';
  const body = nl >= 0 ? raw.slice(nl + 1) : raw;
  const author = r.author_name || r.customer_name || 'Anonymous';
  return {
    id: r.id,
    productId: r.product_id,
    author,
    avatarInitials: (author.substring(0, 1) || 'A').toUpperCase(),
    rating: r.rating,
    title,
    body,
    date: r.created_at,
    helpful: r.helpful_count ?? 0,
    sellerReply: r.reply_text || null,
    verified: Boolean(r.is_approved),
  };
}

async function getReviews(req, res, next) {
  try {
    const { productId } = req.query;
    if (!productId) {
      throw new AppError('productId is required', 400, 'INVALID_PRODUCT');
    }
    const { rows } = await pool.query(
      `SELECT
        r.id, r.product_id, r.rating, r.comment, r.is_approved,
        r.helpful_count, r.reply_text, r.created_at,
        COALESCE(cu.full_name, u.full_name) AS author_name
      FROM reviews r
      LEFT JOIN users u ON u.id = r.customer_id
      LEFT JOIN customer_user cu ON cu.user_id = r.customer_id
      WHERE r.product_id = $1
      ORDER BY r.created_at DESC
      LIMIT 200`,
      [productId]
    );

    res.json({ success: true, reviews: rows.map(mapReview) });
  } catch (e) { next(e); }
}

async function addReview(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
    }
    const input = validateReviewInput(req.body || {});

    // One review per customer per product.
    const existing = await pool.query(
      `SELECT id FROM reviews WHERE customer_id = $1 AND product_id = $2`,
      [userId, input.productId]
    );
    if (existing.rows.length > 0) {
      throw new AppError('You have already reviewed this product', 409, 'ALREADY_REVIEWED');
    }

    const { rows } = await pool.query(
      `INSERT INTO reviews (product_id, customer_id, rating, comment, is_approved)
       VALUES ($1, $2, $3, $4, true)
       RETURNING *`,
      [input.productId, userId, input.rating, input.comment]
    );

    const name = req.user?.full_name || req.user?.fullName || 'Anonymous';
    res.status(201).json({
      success: true,
      review: {
        ...mapReview({ ...rows[0], author_name: name }),
      },
    });
  } catch (e) { next(e); }
}

async function markHelpful(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = $1 RETURNING helpful_count`,
      [id]
    );
    if (rows.length === 0) {
      throw new AppError('Review not found', 404, 'NOT_FOUND');
    }
    res.json({ success: true, helpful: rows[0].helpful_count });
  } catch (e) { next(e); }
}

module.exports = {
  getReviews,
  addReview,
  markHelpful,
};
