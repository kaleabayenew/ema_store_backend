const { pool } = require('../../../core/config/database');

// NOTE: order_items.price_at_order is already stored in cents — never
// multiply it by 100 again. wallet_transactions.amount is stored in ETB.

async function getStats(partnerId) {
  // Execute all dashboard queries in parallel to minimize latency
  const [prodRes, orderRes, revenueRes, ratingRes, chartRes, todayRes, yesterdayRes, lowStockRes, newOrdersRes] = await Promise.all([
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
    // Total revenue (sum of completed/active order items, cents)
    pool.query(
      `SELECT COALESCE(SUM(
         COALESCE(order_items.price_at_order, 0) * order_items.quantity
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
    // 7-day sales chart (cents per day)
    pool.query(
      `SELECT
         DATE(orders.created_at) AS date,
         COALESCE(SUM(
           COALESCE(order_items.price_at_order, 0) * order_items.quantity
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
    // Today's sales (cents)
    pool.query(
      `SELECT COALESCE(SUM(
         COALESCE(order_items.price_at_order, 0) * order_items.quantity
       ), 0)::bigint AS total
       FROM order_items
       JOIN products ON products.id = order_items.product_id
       JOIN orders ON orders.id = order_items.order_id
       WHERE products.partner_id = $1
         AND orders.created_at >= date_trunc('day', NOW())
         AND orders.status != 'CANCELLED'`,
      [partnerId],
    ),
    // Yesterday's sales (cents) — for the change indicator
    pool.query(
      `SELECT COALESCE(SUM(
         COALESCE(order_items.price_at_order, 0) * order_items.quantity
       ), 0)::bigint AS total
       FROM order_items
       JOIN products ON products.id = order_items.product_id
       JOIN orders ON orders.id = order_items.order_id
       WHERE products.partner_id = $1
         AND orders.created_at >= date_trunc('day', NOW()) - INTERVAL '1 day'
         AND orders.created_at < date_trunc('day', NOW())
         AND orders.status != 'CANCELLED'`,
      [partnerId],
    ),
    // Low stock count (stock <= 5)
    pool.query(
      `SELECT COUNT(*)::int AS total FROM products
       WHERE partner_id = $1 AND COALESCE(stock, stock_quantity, 0) <= 5`,
      [partnerId],
    ),
    // New orders awaiting partner action (PENDING-family statuses only —
    // anything the partner still needs to confirm/pack).
    pool.query(
      `SELECT COUNT(DISTINCT orders.id)::int AS total
       FROM orders
       JOIN order_items ON order_items.order_id = orders.id
       JOIN products ON products.id = order_items.product_id
       WHERE products.partner_id = $1
         AND orders.status NOT IN (
           'CONFIRMED','PROCESSING','PACKED','SHIPPED','IN_TRANSIT',
           'OUT_FOR_DELIVERY','DELIVERED','COMPLETED','CANCELLED','CANCELED',
           'RETURNED','REFUNDED'
         )`,
      [partnerId],
    ),
  ]);

  const totalRevCents = Number(revenueRes.rows[0]?.total ?? 0);
  const todayCents = Number(todayRes.rows[0]?.total ?? 0);
  const yesterdayCents = Number(yesterdayRes.rows[0]?.total ?? 0);

  let salesChange = '';
  if (yesterdayCents > 0) {
    const pct = Math.round(((todayCents - yesterdayCents) / yesterdayCents) * 100);
    salesChange = `${pct >= 0 ? '+' : ''}${pct}%`;
  } else if (todayCents > 0) {
    salesChange = 'New';
  }

  return {
    // Legacy keys (kept for older app versions)
    totalProducts: prodRes.rows[0]?.total ?? 0,
    totalOrders: orderRes.rows[0]?.total ?? 0,
    totalRevenueCents: totalRevCents,
    avgRating: parseFloat(ratingRes.rows[0]?.avg) || 0,
    salesChart: chartRes.rows.map(r => ({ date: r.date, amount: Number(r.amount) })),
    // Keys the partner app dashboard actually reads (money in cents)
    today_sales: todayCents,
    total_earnings: totalRevCents,
    new_orders: newOrdersRes.rows[0]?.total ?? 0,
    low_stock: lowStockRes.rows[0]?.total ?? 0,
    sales_change: salesChange,
  };
}

module.exports = { getStats };
