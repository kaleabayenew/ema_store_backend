const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');

async function getEarnings(partnerId) {
  // Execute all earnings queries in parallel
  const [totalRes, thisMonthRes, lastMonthRes, pendingRes, chartRes, commissionRes, settledRes] = await Promise.all([
    // Total revenue from completed/delivered order items
    pool.query(
      `SELECT COALESCE(SUM(
         COALESCE(oi.price_at_order, 0) * oi.quantity - COALESCE(oi.commission_cents, 0)
       ), 0)::bigint AS total_revenue
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN orders o ON o.id = oi.order_id
       WHERE p.partner_id = $1 AND o.status IN ('DELIVERED', 'COMPLETED')`,
      [partnerId],
    ),
    // This month
    pool.query(
      `SELECT COALESCE(SUM(
         COALESCE(oi.price_at_order, 0) * oi.quantity - COALESCE(oi.commission_cents, 0)
       ), 0)::bigint AS amount
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN orders o ON o.id = oi.order_id
       WHERE p.partner_id = $1
         AND o.status IN ('DELIVERED', 'COMPLETED')
         AND DATE_TRUNC('month', o.created_at) = DATE_TRUNC('month', NOW())`,
      [partnerId],
    ),
    // Last month
    pool.query(
      `SELECT COALESCE(SUM(
         COALESCE(oi.price_at_order, 0) * oi.quantity - COALESCE(oi.commission_cents, 0)
       ), 0)::bigint AS amount
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN orders o ON o.id = oi.order_id
       WHERE p.partner_id = $1
         AND o.status IN ('DELIVERED', 'COMPLETED')
         AND DATE_TRUNC('month', o.created_at) = DATE_TRUNC('month', NOW() - INTERVAL '1 month')`,
      [partnerId],
    ),
    // Pending payout from wallet — amount is stored as-is (same unit as revenue cents)
    pool.query(
      `SELECT COALESCE(SUM(ABS(amount)) * 100, 0)::bigint AS pending
       FROM wallet_transactions
       WHERE user_id = $1 AND type IN ('PAYOUT_REQUEST','TRANSFER_REQUEST') AND status = 'PENDING'`,
      [partnerId],
    ),
    // Weekly earnings chart — last 4 ISO weeks (Mon–Sun), revenue in cents
    pool.query(
      `SELECT
         DATE_TRUNC('week', o.created_at)::date AS week_start,
         COALESCE(SUM(
           COALESCE(oi.price_at_order, 0) * oi.quantity - COALESCE(oi.commission_cents, 0)
         ), 0)::bigint AS amount
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN orders o ON o.id = oi.order_id
       WHERE p.partner_id = $1
         AND o.status IN ('DELIVERED', 'COMPLETED')
         AND o.created_at >= NOW() - INTERVAL '4 weeks'
       GROUP BY week_start
       ORDER BY week_start ASC`,
      [partnerId],
    ),
    // Platform commission paid by this partner on delivered orders.
    pool.query(
      `SELECT COALESCE(SUM(oi.commission_cents), 0)::bigint AS commission
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN orders o ON o.id = oi.order_id
       WHERE p.partner_id = $1 AND o.status IN ('DELIVERED', 'COMPLETED')`,
      [partnerId],
    ),
    // Escrow payouts already deposited into this partner's wallet.
    pool.query(
      `SELECT COALESCE(SUM(amount) * 100, 0)::bigint AS settled
       FROM wallet_transactions
       WHERE user_id = $1 AND type = 'ORDER_PAYOUT' AND status = 'COMPLETED'`,
      [partnerId],
    ),
  ]);

  const totalRev = Number(totalRes.rows[0]?.total_revenue ?? 0);
  const pending = Number(pendingRes.rows[0]?.pending ?? 0);
  const commissionCents = Number(commissionRes.rows[0]?.commission ?? 0);
  let commissionPct = null;
  try {
    const feeSvc = require('../../delivery/delivery_fee.service');
    commissionPct = (await feeSvc.getSettings()).partnerCommissionPct;
  } catch (_) { /* settings table may not exist yet */ }
  const available = Math.max(0, totalRev - pending);

  return {
    totalRevenueCents: totalRev,
    totalCommissionCents: commissionCents,
    commissionPct,
    settledPayoutCents: Number(settledRes.rows[0]?.settled ?? 0),
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

// Available balance in cents = delivered revenue (cents) − pending payouts
// (wallet_transactions.amount is ETB, so it is converted ×100).
async function availableBalanceCents(partnerId) {
  const [rev, pend] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(COALESCE(oi.price_at_order, 0) * oi.quantity - COALESCE(oi.commission_cents, 0)), 0)::bigint AS total
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN orders o ON o.id = oi.order_id
       WHERE p.partner_id = $1 AND o.status IN ('DELIVERED', 'COMPLETED')`,
      [partnerId],
    ),
    pool.query(
      `SELECT COALESCE(SUM(ABS(amount)) * 100, 0)::bigint AS pending
       FROM wallet_transactions
       WHERE user_id = $1 AND type IN ('PAYOUT_REQUEST','TRANSFER_REQUEST') AND status = 'PENDING'`,
      [partnerId],
    ),
  ]);
  return Math.max(
    0,
    Number(rev.rows[0]?.total ?? 0) - Number(pend.rows[0]?.pending ?? 0),
  );
}

async function requestPayout(partnerId, amount, details = {}) {
  if (!amount || amount <= 0) {
    throw new AppError('Invalid payout amount.', 400, 'INVALID_AMOUNT');
  }
  const availableEtb = (await availableBalanceCents(partnerId)) / 100;
  if (amount > availableEtb + 0.005) {
    throw new AppError(
      `Amount exceeds your available balance (ETB ${availableEtb.toFixed(2)}).`,
      400,
      'INSUFFICIENT_BALANCE',
    );
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
  const availableEtb = (await availableBalanceCents(partnerId)) / 100;
  if (amount > availableEtb + 0.005) {
    throw new AppError(
      `Amount exceeds your available balance (ETB ${availableEtb.toFixed(2)}).`,
      400,
      'INSUFFICIENT_BALANCE',
    );
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
