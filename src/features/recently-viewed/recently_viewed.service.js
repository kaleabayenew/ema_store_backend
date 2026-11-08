// src/features/recently-viewed/recently_viewed.service.js

const { pool } = require('../../core/config/database');

class RecentlyViewedService {
  // Get user's recently viewed products
  async getUserRecentlyViewed(userId, limit = 20) {
    const query = `
      SELECT
        rv.product_id,
        rv.viewed_at,
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
      FROM recently_viewed rv
      LEFT JOIN products p ON rv.product_id = p.id
      WHERE rv.user_id = $1
      ORDER BY rv.viewed_at DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [userId, limit]);

    return {
      success: true,
      items: result.rows.map(row => ({
        productId: row.product_id,
        viewedAt: row.viewed_at,
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

  // Track product view
  async trackProductView(userId, productId) {
    const query = `
      INSERT INTO recently_viewed (user_id, product_id, viewed_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id, product_id)
      DO UPDATE SET viewed_at = NOW()
      RETURNING *
    `;

    const result = await pool.query(query, [userId, productId]);

    // Clean up old views (keep only last 50)
    await this._cleanupOldViews(userId);

    return {
      success: true,
      message: 'Product view tracked',
      item: result.rows[0]
    };
  }

  // Remove product from recently viewed
  async removeFromRecentlyViewed(userId, productId) {
    const query = `
      DELETE FROM recently_viewed
      WHERE user_id = $1 AND product_id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [userId, productId]);

    if (result.rows.length === 0) {
      throw new Error('Item not found in recently viewed');
    }

    return {
      success: true,
      message: 'Removed from recently viewed'
    };
  }

  // Clear recently viewed
  async clearRecentlyViewed(userId) {
    const query = `
      DELETE FROM recently_viewed
      WHERE user_id = $1
    `;

    await pool.query(query, [userId]);

    return {
      success: true,
      message: 'Recently viewed cleared'
    };
  }

  // Helper: Clean up old views (keep only last 50)
  async _cleanupOldViews(userId) {
    const query = `
      DELETE FROM recently_viewed
      WHERE user_id = $1
      AND id NOT IN (
        SELECT id FROM recently_viewed
        WHERE user_id = $1
        ORDER BY viewed_at DESC
        LIMIT 50
      )
    `;

    await pool.query(query, [userId]);
  }
}

module.exports = new RecentlyViewedService();
