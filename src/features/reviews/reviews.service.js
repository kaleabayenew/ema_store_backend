// src/features/reviews/reviews.service.js

const { pool } = require('../../core/config/database');

class ReviewsService {
  // Get reviews for a product
  async getProductReviews(productId, limit = 20, offset = 0) {
    const query = `
      SELECT
        r.id,
        r.product_id,
        r.user_id,
        u.full_name as reviewer_name,
        r.rating,
        r.title,
        r.comment,
        r.created_at,
        r.updated_at
      FROM reviews r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.product_id = $1
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [productId, limit, offset]);

    return {
      success: true,
      reviews: result.rows.map(row => ({
        id: row.id,
        productId: row.product_id,
        userId: row.user_id,
        reviewerName: row.reviewer_name,
        rating: parseInt(row.rating),
        title: row.title,
        comment: row.comment,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    };
  }

  // Get user's reviews
  async getUserReviews(userId, limit = 20, offset = 0) {
    const query = `
      SELECT
        r.id,
        r.product_id,
        r.user_id,
        p.name as product_name,
        p.image_url as product_image,
        r.rating,
        r.title,
        r.comment,
        r.created_at,
        r.updated_at
      FROM reviews r
      LEFT JOIN products p ON r.product_id = p.id
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [userId, limit, offset]);

    return {
      success: true,
      reviews: result.rows.map(row => ({
        id: row.id,
        productId: row.product_id,
        userId: row.user_id,
        productName: row.product_name,
        productImage: row.product_image,
        rating: parseInt(row.rating),
        title: row.title,
        comment: row.comment,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    };
  }

  // Create a review
  async createReview(userId, productId, data) {
    const { rating, title, comment } = data;

    if (!rating || rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    // Check if user already reviewed this product
    const checkQuery = `
      SELECT id FROM reviews
      WHERE user_id = $1 AND product_id = $2
    `;

    const checkResult = await pool.query(checkQuery, [userId, productId]);

    if (checkResult.rows.length > 0) {
      throw new Error('You have already reviewed this product');
    }

    const query = `
      INSERT INTO reviews (user_id, product_id, rating, title, comment)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const result = await pool.query(query, [userId, productId, rating, title, comment]);

    // Update product's average rating and review count
    await this._updateProductRating(productId);

    return {
      success: true,
      message: 'Review created successfully',
      review: {
        id: result.rows[0].id,
        productId: result.rows[0].product_id,
        userId: result.rows[0].user_id,
        rating: parseInt(result.rows[0].rating),
        title: result.rows[0].title,
        comment: result.rows[0].comment,
        createdAt: result.rows[0].created_at
      }
    };
  }

  // Update a review
  async updateReview(reviewId, userId, data) {
    const { rating, title, comment } = data;

    if (rating && (rating < 1 || rating > 5)) {
      throw new Error('Rating must be between 1 and 5');
    }

    const query = `
      UPDATE reviews
      SET rating = COALESCE($1, rating),
          title = COALESCE($2, title),
          comment = COALESCE($3, comment),
          updated_at = NOW()
      WHERE id = $4 AND user_id = $5
      RETURNING *
    `;

    const result = await pool.query(query, [rating, title, comment, reviewId, userId]);

    if (result.rows.length === 0) {
      throw new Error('Review not found or you do not have permission to update it');
    }

    // Update product's average rating
    await this._updateProductRating(result.rows[0].product_id);

    return {
      success: true,
      message: 'Review updated successfully',
      review: {
        id: result.rows[0].id,
        productId: result.rows[0].product_id,
        userId: result.rows[0].user_id,
        rating: parseInt(result.rows[0].rating),
        title: result.rows[0].title,
        comment: result.rows[0].comment,
        createdAt: result.rows[0].created_at,
        updatedAt: result.rows[0].updated_at
      }
    };
  }

  // Delete a review
  async deleteReview(reviewId, userId) {
    const query = `
      DELETE FROM reviews
      WHERE id = $1 AND user_id = $2
      RETURNING product_id
    `;

    const result = await pool.query(query, [reviewId, userId]);

    if (result.rows.length === 0) {
      throw new Error('Review not found or you do not have permission to delete it');
    }

    // Update product's average rating
    await this._updateProductRating(result.rows[0].product_id);

    return {
      success: true,
      message: 'Review deleted successfully'
    };
  }

  // Get review statistics for a product
  async getProductReviewStats(productId) {
    const query = `
      SELECT
        COUNT(*) as total_reviews,
        AVG(rating) as average_rating,
        COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star,
        COUNT(CASE WHEN rating = 4 THEN 1 END) as four_star,
        COUNT(CASE WHEN rating = 3 THEN 1 END) as three_star,
        COUNT(CASE WHEN rating = 2 THEN 1 END) as two_star,
        COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star
      FROM reviews
      WHERE product_id = $1
    `;

    const result = await pool.query(query, [productId]);

    return {
      success: true,
      stats: {
        totalReviews: parseInt(result.rows[0].total_reviews),
        averageRating: result.rows[0].average_rating ? parseFloat(result.rows[0].average_rating).toFixed(1) : 0,
        fiveStar: parseInt(result.rows[0].five_star),
        fourStar: parseInt(result.rows[0].four_star),
        threeStar: parseInt(result.rows[0].three_star),
        twoStar: parseInt(result.rows[0].two_star),
        oneStar: parseInt(result.rows[0].one_star)
      }
    };
  }

  // Helper: Update product's average rating and review count
  async _updateProductRating(productId) {
    const statsQuery = `
      SELECT
        COUNT(*) as review_count,
        AVG(rating) as average_rating
      FROM reviews
      WHERE product_id = $1
    `;

    const statsResult = await pool.query(statsQuery, [productId]);

    const reviewCount = parseInt(statsResult.rows[0].review_count);
    const averageRating = statsResult.rows[0].average_rating ? parseFloat(statsResult.rows[0].average_rating) : 0;

    const updateQuery = `
      UPDATE products
      SET review_count = $1,
          rating = $2
      WHERE id = $3
    `;

    await pool.query(updateQuery, [reviewCount, averageRating, productId]);
  }
}

module.exports = new ReviewsService();
