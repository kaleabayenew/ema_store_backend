const { pool } = require('../../../core/config/database');

async function getStats(partnerId) {
  // Total products
  const { rows: prodRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM products WHERE partner_id = $1`,
    [partnerId],
  );

  // Total distinct orders that contain partner's products
  const { rows: orderRows } = await pool.query(
    `SELECT COUNT(DISTINCT order_items.order_id)::int AS total
     FROM order_items
     JOIN products ON products.id = order_items.product_id
     WHERE products.partner_id = $1`,
    [partnerId],
  );

  // Total revenue (sum of completed order items)
  const { rows: revenueRows } = await pool.query(
    `SELECT COALESCE(SUM(
       ROUND(COALESCE(order_items.price_at_order, 0) * 100) * order_items.quantity
     ), 0)::bigint AS total
     FROM order_items
     JOIN products ON products.id = order_items.product_id
     JOIN orders ON orders.id = order_items.order_id
     WHERE products.partner_id = $1 AND orders.status != 'CANCELLED'`,
    [partnerId],
  );

  // Average rating
  const { rows: ratingRows } = await pool.query(
    `SELECT COALESCE(AVG(reviews.rating), 0)::float AS avg
     FROM reviews
     JOIN products ON products.id = reviews.product_id
     WHERE products.partner_id = $1`,
    [partnerId],
  );

  // 7-day sales chart
  const { rows: chartRows } = await pool.query(
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
  );

  return {
    totalProducts: prodRows[0].total,
    totalOrders: orderRows[0].total,
    totalRevenueCents: Number(revenueRows[0].total),
    avgRating: parseFloat(ratingRows[0].avg) || 0,
    salesChart: chartRows.map(r => ({ date: r.date, amount: Number(r.amount) })),
  };
}

module.exports = { getStats };
