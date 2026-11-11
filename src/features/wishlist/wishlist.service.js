// src/features/wishlist/wishlist.service.js

const { pool } = require('../../core/config/database');

// wishlist.created_at may be missing on older schemas (failed migration).
// Ensure it once per process so wishlist queries never 500.
let _wishlistEnsured = null;
function ensureWishlistColumns() {
  if (!_wishlistEnsured) {
    _wishlistEnsured = pool
      .query(`ALTER TABLE wishlist ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`)
      .catch(() => {});
  }
  return _wishlistEnsured;
}

class WishlistService {
  // Get user's wishlist
  async getUserWishlist(userId) {
    await ensureWishlistColumns();
    const query = `
      SELECT
        w.product_id,
        w.created_at,
        p.id,
        COALESCE(p.name_en, p.name) AS name,
        COALESCE(p.description_en, p.description) AS description,
        p.price_cents,
        p.discount_cents,
        COALESCE(pi.image_url, p.image_url) AS image_url,
        p.rating_avg AS rating,
        p.rating_count AS review_count,
        p.stock
      FROM wishlist w
      JOIN products p ON w.product_id = p.id
      LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = true
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC
    `;

    const result = await pool.query(query, [userId]);

    return {
      success: true,
      items: result.rows.map(row => ({
        productId: row.product_id,
        createdAt: row.created_at,
        product: {
          id: row.id,
          name: row.name,
          description: row.description,
          priceCents: parseInt(row.price_cents),
          discountCents: row.discount_cents ? parseInt(row.discount_cents) : null,
          imageUrl: row.image_url,
          rating: row.rating ? parseFloat(row.rating) : 0,
          reviewCount: row.review_count ? parseInt(row.review_count) : 0,
          stock: row.stock ? parseInt(row.stock) : 0
        }
      }))
    };
  }

  // Add product to wishlist
  async addToWishlist(userId, productId) {
    const query = `
      INSERT INTO wishlist (user_id, product_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, product_id) DO NOTHING
      RETURNING *
    `;

    const result = await pool.query(query, [userId, productId]);

    return {
      success: true,
      message: result.rows.length > 0 ? 'Added to wishlist' : 'Already in wishlist',
      item: result.rows[0]
    };
  }

  // Remove product from wishlist
  async removeFromWishlist(userId, productId) {
    const query = `
      DELETE FROM wishlist
      WHERE user_id = $1 AND product_id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [userId, productId]);

    if (result.rows.length === 0) {
      throw new Error('Item not found in wishlist');
    }

    return {
      success: true,
      message: 'Removed from wishlist'
    };
  }

  // Check if product is in wishlist
  async isInWishlist(userId, productId) {
    const query = `
      SELECT 1
      FROM wishlist
      WHERE user_id = $1 AND product_id = $2
    `;

    const result = await pool.query(query, [userId, productId]);

    return {
      success: true,
      inWishlist: result.rows.length > 0
    };
  }

  // Clear wishlist
  async clearWishlist(userId) {
    const query = `
      DELETE FROM wishlist
      WHERE user_id = $1
    `;

    await pool.query(query, [userId]);

    return {
      success: true,
      message: 'Wishlist cleared'
    };
  }
}

module.exports = new WishlistService();
