const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

async function getReviews(req, res, next) {
  try {
    const { productId } = req.query;
    const { rows } = await pool.query(
      `SELECT 
        r.id,
        r.product_id,
        r.rating,
        r.title,
        r.body,
        r.helpful,
        r.seller_reply,
        r.verified,
        r.created_at,
        u.full_name as author,
        COALESCE(SUBSTRING(u.full_name, 1, 1), 'A') as avatar_initials
      FROM reviews r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.product_id = $1
      ORDER BY r.created_at DESC`,
      [productId]
    );
    
    const reviews = rows.map(r => ({
      id: r.id,
      productId: r.product_id,
      author: r.author || 'Anonymous',
      avatarInitials: r.avatar_initials,
      rating: r.rating,
      title: r.title,
      body: r.body,
      date: r.created_at,
      helpful: r.helpful,
      sellerReply: r.seller_reply,
      verified: r.verified,
    }));

    res.json({ success: true, reviews });
  } catch (e) { next(e); }
}

async function addReview(req, res, next) {
  try {
    const { productId, rating, title, body } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
    }

    const { rows } = await pool.query(
      `INSERT INTO reviews (product_id, user_id, rating, title, body, verified)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [productId, userId, rating, title, body]
    );

    const review = rows[0];
    res.status(201).json({
      success: true,
      review: {
        id: review.id,
        productId: review.product_id,
        author: req.user?.full_name || 'Anonymous',
        avatarInitials: (req.user?.full_name || 'A').substring(0, 1).toUpperCase(),
        rating: review.rating,
        title: review.title,
        body: review.body,
        date: review.created_at,
        helpful: review.helpful,
        verified: review.verified,
      },
    });
  } catch (e) { next(e); }
}

async function markHelpful(req, res, next) {
  try {
    const { id } = req.params;
    
    const { rows } = await pool.query(
      `UPDATE reviews SET helpful = helpful + 1 WHERE id = $1 RETURNING *`,
      [id]
    );

    if (rows.length === 0) {
      throw new AppError('Review not found', 404, 'NOT_FOUND');
    }

    res.json({ success: true, helpful: rows[0].helpful });
  } catch (e) { next(e); }
}

module.exports = {
  getReviews,
  addReview,
  markHelpful,
};
