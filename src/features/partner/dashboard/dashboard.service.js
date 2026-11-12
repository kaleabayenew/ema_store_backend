const { pool } = require('../../../core/config/database');

async function getStats(partnerId) {
  // Execute all dashboard queries in parallel to minimize latency
  const [prodRes, orderRes, revenueRes, ratingRes, chartRes] = await Promise.all([
    // Total products
    pool.query(
      `SELECT COUNT(*)::int AS total FROM products WHERE partner_id = $1`,
      [partnerId],
    ),
    // Total distinct orders that contain partner's products
    pool.query(
      `SELECT COUNT(DISTINCT order_items.order_id)::int AS total
       FROM order_items
       JOIN products ON products.id = order_items.product_id
       WHERE products.partner_id = $1`,
      [partnerId],
    ),
    // Total revenue (sum of completed/active order items)
    pool.query(
      `SELECT COALESCE(SUM(
         ROUND(COALESCE(order_items.price_at_order, 0) * 100) * order_items.quantity
       ), 0)::bigint AS total
       FROM order_items
       JOIN products ON products.id = order_items.product_id
       JOIN orders ON orders.id = order_items.order_id
       WHERE products.partner_id = $1 AND orders.status != 'CANCELLED'`,
      [partnerId],
    ),
    // Average rating
    pool.query(
      `SELECT COALESCE(AVG(reviews.rating), 0)::float AS avg
       FROM reviews
       JOIN products ON products.id = reviews.product_id
       WHERE products.partner_id = $1`,
      [partnerId],
    ),
    // 7-day sales chart
    pool.query(
      `SELECT
         DATE(orders.created_at) AS date,
         COALESCE(SUM(
           ROUND(COALESCE(order_items.price_at_order, 0) * 100) * order_items.quantity
         ), 0)::bigint AS amount
       FROM order_items
       JOIN products ON products.id = order_items.product_id
       JOIN orders ON orders.id = order_items.order_id
       WHERE products.partner_id = $1
         AND orders.created_at >= NOW() - INTERVAL '7 days'
         AND orders.status != 'CANCELLED'
       GROUP BY DATE(orders.created_at)
       ORDER BY date ASC`,
      [partnerId],
    ),
  ]);

  return {
    totalProducts: prodRes.rows[0]?.total ?? 0,
    totalOrders: orderRes.rows[0]?.total ?? 0,
    totalRevenueCents: Number(revenueRes.rows[0]?.total ?? 0),
    avgRating: parseFloat(ratingRes.rows[0]?.avg) || 0,
    salesChart: chartRes.rows.map(r => ({ date: r.date, amount: Number(r.amount) })),
  };
}

module.exports = { getStats };
