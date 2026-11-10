// src/features/admin/credits.service.js

const { pool } = require('../../core/config/database');

const PAGE_LIMIT_MAX = 100;

/**
 * List wallet transactions across all users (customers, partners, riders)
 * for the admin Credits page.
 *
 * Filters:
 *  - q          : search title/description/phone/display name
 *  - role       : CUSTOMER | PARTNER | RIDE | ALL
 *  - direction  : deposit | withdraw | all
 *  - currency   : balance | coins | all
 *  - status     : COMPLETED | PENDING | ... (exact match)
 */
async function getTransactions({
  q,
  role,
  direction = 'all',
  currency = 'all',
  status,
  page = 1,
  limit = 20,
} = {}) {
  const where = [];
  const params = [];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (q && q.trim()) {
    const like = push(`%${q.trim()}%`);
    where.push(`(
      wt.title ILIKE ${like} OR wt.description ILIKE ${like}
      OR u.phone ILIKE ${like} OR u.full_name ILIKE ${like} OR u.email ILIKE ${like}
      OR cu.full_name ILIKE ${like} OR pp.business_name ILIKE ${like} OR pp.owner_name ILIKE ${like}
    )`);
  }

  if (role && role !== 'ALL') {
    where.push(`u.role = ${push(role)}`);
  }

  if (status) {
    where.push(`wt.status = ${push(status)}`);
  }

  // Coin transactions are identified by a COIN marker in the type string.
  // Everything else is a real-balance (ETB) transaction.
  if (currency === 'coins') {
    where.push(`wt.type ILIKE '%COIN%'`);
  } else if (currency === 'balance') {
    where.push(`wt.type NOT ILIKE '%COIN%'`);
  }

  // Payout/withdrawal types move money out even when amount is stored positive.
  if (direction === 'withdraw') {
    where.push(`(wt.amount < 0 OR wt.type ILIKE '%WITHDRAW%' OR wt.type ILIKE '%PAYOUT%')`);
  } else if (direction === 'deposit') {
    where.push(`(wt.amount > 0 AND wt.type NOT ILIKE '%WITHDRAW%' AND wt.type NOT ILIKE '%PAYOUT%')`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(PAGE_LIMIT_MAX, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (safePage - 1) * safeLimit;

  const from = `
    FROM wallet_transactions wt
    LEFT JOIN users u ON u.id = wt.user_id
    LEFT JOIN customer_user cu ON cu.user_id = u.id
    LEFT JOIN partner_profile pp ON pp.user_id = u.id
    ${whereSql}
  `;

  const [rowsRes, countRes] = await Promise.all([
    pool.query(
      `SELECT
         wt.id, wt.title, wt.description, wt.amount, wt.type, wt.status,
         wt.metadata, wt.created_at,
         u.id AS user_id, u.role, u.phone, u.email, u.full_name AS user_full_name,
         u.balance, u.coins,
         COALESCE(cu.full_name, pp.business_name, pp.owner_name, u.full_name, u.phone) AS display_name
       ${from}
       ORDER BY wt.created_at DESC
       LIMIT ${push(safeLimit)} OFFSET ${push(offset)}`,
      params,
    ),
    pool.query(`SELECT COUNT(*)::int AS total ${from}`, params.slice(0, params.length - 2)),
  ]);

  return {
    transactions: rowsRes.rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      amount: parseFloat(r.amount),
      type: r.type,
      status: r.status,
      metadata: r.metadata,
      createdAt: r.created_at,
      user: r.user_id
        ? {
            id: r.user_id,
            role: r.role,
            phone: r.phone,
            email: r.email,
            name: r.display_name || 'Unknown',
            balance: parseFloat(r.balance) || 0,
            coins: r.coins || 0,
          }
        : null,
    })),
    total: countRes.rows[0]?.total || 0,
    page: safePage,
    limit: safeLimit,
  };
}

/**
 * Aggregate balances across wallet users, grouped by role.
 */
async function getSummary() {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(u.role, 'UNKNOWN') AS role,
      COUNT(DISTINCT u.id)::int AS users,
      COALESCE(SUM(u.balance), 0)::numeric AS total_balance,
      COALESCE(SUM(COALESCE(u.coins, 0)), 0)::bigint AS total_coins
    FROM users u
    WHERE u.role IN ('CUSTOMER', 'PARTNER', 'RIDE')
       OR EXISTS (SELECT 1 FROM wallet_transactions wt WHERE wt.user_id = u.id)
    GROUP BY u.role
    ORDER BY u.role
  `);

  const byRole = {};
  let totalBalance = 0;
  let totalCoins = 0;

  for (const r of rows) {
    const balance = parseFloat(r.total_balance) || 0;
    const coins = parseInt(r.total_coins, 10) || 0;
    byRole[r.role] = { users: r.users, balance, coins };
    totalBalance += balance;
    totalCoins += coins;
  }

  return { totalBalance, totalCoins, byRole };
}

module.exports = { getTransactions, getSummary };
