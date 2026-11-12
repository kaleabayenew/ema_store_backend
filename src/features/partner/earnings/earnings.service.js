const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');

async function getEarnings(partnerId) {
  // Execute all earnings queries in parallel
  const [totalRes, thisMonthRes, lastMonthRes, pendingRes, chartRes] = await Promise.all([
    // Total revenue from completed order items
    pool.query(
      `SELECT COALESCE(SUM(
         ROUND(COALESCE(oi.price_at_order, 0) * 100) * oi.quantity
       ), 0)::bigint AS total_revenue
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN orders o ON o.id = oi.order_id
       WHERE p.partner_id = $1 AND o.status = 'COMPLETED'`,
      [partnerId],
    ),
    // This month
    pool.query(
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
    ),
    // Last month
    pool.query(
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
    ),
    // Pending payout from wallet — amount is stored as-is (same unit as revenue cents)
    pool.query(
      `SELECT COALESCE(SUM(ABS(amount)), 0)::bigint AS pending
       FROM wallet_transactions
       WHERE user_id = $1 AND type = 'PAYOUT_REQUEST' AND status = 'PENDING'`,
      [partnerId],
    ),
    // Weekly earnings chart — last 4 ISO weeks (Mon–Sun), revenue in cents
    pool.query(
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
    ),
  ]);

  const totalRev = Number(totalRes.rows[0]?.total_revenue ?? 0);
  const pending = Number(pendingRes.rows[0]?.pending ?? 0);
  const available = Math.max(0, totalRev - pending);

  return {
    totalRevenueCents: totalRev,
    thisMonthCents: Number(thisMonthRes.rows[0]?.amount ?? 0),
    lastMonthCents: Number(lastMonthRes.rows[0]?.amount ?? 0),
    pendingPayoutCents: pending,
    available_balance: available / 100, // ETB
    balance: totalRev / 100, // ETB for app compatibility
    weeklyChart: chartRes.rows.map((r) => ({ weekStart: r.week_start, amount: Number(r.amount) })),
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

async function requestPayout(partnerId, amount, details = {}) {
  if (!amount || amount <= 0) {
    throw new AppError('Invalid payout amount.', 400, 'INVALID_AMOUNT');
  }

  const method = details.method === 'telebirr' ? 'telebirr' : 'bank';
  const description = method === 'telebirr'
    ? `Telebirr: ${details.telebirrPhone || ''}`
    : `Bank: ${details.bankName || ''} — Acct: ${details.accountNumber || ''}`;

  const { rows } = await pool.query(
    `INSERT INTO wallet_transactions (user_id, amount, title, description, type, status, metadata)
     VALUES ($1, $2, 'Payout Request', $3, 'PAYOUT_REQUEST', 'PENDING', $4)
     RETURNING *`,
    [partnerId, amount, description, JSON.stringify({ method, ...details })],
  );
  return rows[0];
}

async function requestTransfer(partnerId, { amount, recipientPhone, method, accountNumber }) {
  if (!amount || amount <= 0) {
    throw new AppError('Invalid transfer amount.', 400, 'INVALID_AMOUNT');
  }
  if (!recipientPhone && !accountNumber) {
    throw new AppError('Recipient phone or account number is required.', 400, 'MISSING_FIELDS');
  }

  const isBank = method === 'bank';
  const destination = isBank ? `Bank acct: ${accountNumber || ''}` : `Telebirr: ${recipientPhone || ''}`;
  const description = `Transfer to ${destination}`;

  const { rows } = await pool.query(
    `INSERT INTO wallet_transactions (user_id, amount, title, description, type, status, metadata)
     VALUES ($1, $2, 'Transfer Request', $3, 'TRANSFER_REQUEST', 'PENDING', $4)
     RETURNING *`,
    [partnerId, amount, description, JSON.stringify({ method: isBank ? 'bank' : 'telebirr', recipientPhone, accountNumber })],
  );
  return rows[0];
}

module.exports = { getEarnings, getTransactions, requestPayout, requestTransfer };
