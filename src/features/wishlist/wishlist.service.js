// src/features/wishlist/wishlist.service.js

const { pool } = require('../../core/config/database');

class WishlistService {
  // Get user's wishlist
  async getUserWishlist(userId) {
    const query = `
      SELECT
        w.product_id,
        w.created_at,
        p.id,
        p.name,
        p.description,
        p.price_cents,
        p.image_url,
        p.old_price_cents,
        p.rating,
        p.review_count,
        p.stock,
        p.category_id
      FROM wishlist w
      LEFT JOIN products p ON w.product_id = p.id
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
          imageUrl: row.image_url,
          oldPriceCents: row.old_price_cents ? parseInt(row.old_price_cents) : null,
          rating: row.rating ? parseFloat(row.rating) : 0,
          reviewCount: row.review_count ? parseInt(row.review_count) : 0,
          stock: row.stock ? parseInt(row.stock) : 0,
          categoryId: row.category_id
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
      SELECT COUNT(*) as count
      FROM wishlist
      WHERE user_id = $1 AND product_id = $2
    `;

    const result = await pool.query(query, [userId, productId]);
    const count = parseInt(result.rows[0].count);

    return {
      success: true,
      inWishlist: count > 0
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
