const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');

async function getEarnings(partnerId) {
  // Total revenue from completed order items
  const { rows: totalRows } = await pool.query(
    `SELECT COALESCE(SUM(
       ROUND(COALESCE(oi.price_at_order, 0) * 100) * oi.quantity
     ), 0)::bigint AS total_revenue
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     JOIN orders o ON o.id = oi.order_id
     WHERE p.partner_id = $1 AND o.status = 'COMPLETED'`,
    [partnerId],
  );

  // This month
  const { rows: thisMonthRows } = await pool.query(
    `SELECT COALESCE(SUM(
       ROUND(COALESCE(oi.price_at_order, 0) * 100) * oi.quantity
     ), 0)::bigint AS amount
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     JOIN orders o ON o.id = oi.order_id
     WHERE p.partner_id = $1
       AND o.status = 'COMPLETED'
       AND DATE_TRUNC('month', o.created_at) = DATE_TRUNC('month', NOW())`,
    [partnerId],
  );

  // Last month
  const { rows: lastMonthRows } = await pool.query(
    `SELECT COALESCE(SUM(
       ROUND(COALESCE(oi.price_at_order, 0) * 100) * oi.quantity
     ), 0)::bigint AS amount
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     JOIN orders o ON o.id = oi.order_id
     WHERE p.partner_id = $1
       AND o.status = 'COMPLETED'
       AND DATE_TRUNC('month', o.created_at) = DATE_TRUNC('month', NOW() - INTERVAL '1 month')`,
    [partnerId],
  );

  // Pending payout from wallet — amount is stored as-is (same unit as revenue cents)
  const { rows: pendingRows } = await pool.query(
    `SELECT COALESCE(SUM(ABS(amount)), 0)::bigint AS pending
     FROM wallet_transactions
     WHERE user_id = $1 AND type = 'PAYOUT_REQUEST' AND status = 'PENDING'`,
    [partnerId],
  );

  // Weekly earnings chart — last 4 ISO weeks (Mon–Sun), revenue in cents
  const { rows: chartRows } = await pool.query(
    `SELECT
       DATE_TRUNC('week', o.created_at)::date AS week_start,
       COALESCE(SUM(
         ROUND(COALESCE(oi.price_at_order, 0) * 100) * oi.quantity
       ), 0)::bigint AS amount
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     JOIN orders o ON o.id = oi.order_id
     WHERE p.partner_id = $1
       AND o.status = 'COMPLETED'
       AND o.created_at >= NOW() - INTERVAL '4 weeks'
     GROUP BY week_start
     ORDER BY week_start ASC`,
    [partnerId],
  );

  return {
    totalRevenueCents: Number(totalRows[0].total_revenue),
    thisMonthCents: Number(thisMonthRows[0].amount),
    lastMonthCents: Number(lastMonthRows[0].amount),
    pendingPayoutCents: Number(pendingRows[0].pending),
    weeklyChart: chartRows.map((r) => ({ weekStart: r.week_start, amount: Number(r.amount) })),
  };
}

async function getTransactions(partnerId, { page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM wallet_transactions WHERE user_id = $1`,
    [partnerId],
  );

  const { rows } = await pool.query(
    `SELECT * FROM wallet_transactions WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [partnerId, limit, offset],
  );

  return { transactions: rows, total: countRows[0].total, page, limit };
}

async function requestPayout(partnerId, amount) {
  if (!amount || amount <= 0) {
    throw new AppError('Invalid payout amount.', 400, 'INVALID_AMOUNT');
  }

  const { rows } = await pool.query(
    `INSERT INTO wallet_transactions (user_id, amount, title, type, status)
     VALUES ($1, $2, 'Payout Request', 'PAYOUT_REQUEST', 'PENDING')
     RETURNING *`,
    [partnerId, amount],
  );
  return rows[0];
}

module.exports = { getEarnings, getTransactions, requestPayout };
