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
  userId,
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

  if (userId) {
    where.push(`wt.user_id = ${push(userId)}`);
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

const STAFF_ROLES = [
  'ADMIN', 'SUPER_ADMIN', 'CUSTOMER_SUPPORT', 'MANAGER', 'MANAGEMENT',
  'PARTNER_MANAGER', 'PRODUCT_MANAGER', 'FINANCE', 'MARKETING',
];

/**
 * List wallet users with their balances, coins and transaction stats.
 * scope 'staff' returns admin/staff accounts (for the Super Admin "Stuff"
 * panel); default scope returns customers, partners and riders.
 */
async function getUsers({ q, role, scope, page = 1, limit = 20 } = {}) {
  const where = [];
  const params = [];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (scope === 'staff') {
    // Only staff who can actually use the Credits page: super admins always,
    // everyone else needs '/credits' explicitly granted in allowed_pages.
    where.push(`u.role = ANY(${push(STAFF_ROLES)}::text[])`);
    where.push(`(
      u.role IN ('SUPER_ADMIN', 'ADMIN')
      OR au.allowed_pages @> '["/credits"]'::jsonb
    )`);
  } else {
    where.push(`u.role IN ('CUSTOMER', 'PARTNER', 'RIDE')`);
  }

  if (q && q.trim()) {
    const like = push(`%${q.trim()}%`);
    where.push(`(
      u.phone ILIKE ${like} OR u.email ILIKE ${like} OR u.full_name ILIKE ${like}
      OR cu.full_name ILIKE ${like} OR pp.business_name ILIKE ${like} OR pp.owner_name ILIKE ${like}
    )`);
  }

  if (role && role !== 'ALL') {
    where.push(`u.role = ${push(role)}`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(PAGE_LIMIT_MAX, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (safePage - 1) * safeLimit;

  const from = `
    FROM users u
    LEFT JOIN customer_user cu ON cu.user_id = u.id
    LEFT JOIN partner_profile pp ON pp.user_id = u.id
    LEFT JOIN admin_user au ON au.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS tx_count, MAX(wt.created_at) AS last_at
      FROM wallet_transactions wt WHERE wt.user_id = u.id
    ) tx ON true
    ${whereSql}
  `;

  const [rowsRes, countRes] = await Promise.all([
    pool.query(
      `SELECT
         u.id, u.role, u.phone, u.email, u.balance, u.coins, u.created_at,
         u.is_active, u.is_blocked,
         au.admin_role, au.allowed_pages,
         COALESCE(cu.full_name, pp.business_name, pp.owner_name, u.full_name, u.phone) AS display_name,
         COALESCE(tx.tx_count, 0) AS tx_count,
         tx.last_at
       ${from}
       ORDER BY u.created_at DESC
       LIMIT ${push(safeLimit)} OFFSET ${push(offset)}`,
      params,
    ),
    pool.query(`SELECT COUNT(*)::int AS total ${from}`, params.slice(0, params.length - 2)),
  ]);

  return {
    users: rowsRes.rows.map((r) => ({
      id: r.id,
      role: r.role,
      adminRole: r.admin_role ?? null,
      allowedPages: Array.isArray(r.allowed_pages) ? r.allowed_pages : [],
      phone: r.phone,
      email: r.email,
      name: r.display_name || 'Unknown',
      balance: parseFloat(r.balance) || 0,
      coins: r.coins || 0,
      status: r.is_blocked ? 'INACTIVE' : (r.is_active ? 'ACTIVE' : 'INACTIVE'),
      transactionCount: r.tx_count || 0,
      lastActivityAt: r.last_at,
      createdAt: r.created_at,
    })),
    total: countRes.rows[0]?.total || 0,
    page: safePage,
    limit: safeLimit,
  };
}

/**
 * Admin deposit/withdraw: adjust a user's real balance and record the
 * movement in wallet_transactions so it shows up in history.
 *
 * direction: 'deposit' credits the balance, 'withdraw' debits it.
 * Withdrawals are rejected when they would make the balance negative.
 */
async function adjustBalance({ userId, direction, amount, note, adminId }) {
  const value = parseFloat(amount);
  if (!userId || !direction || !Number.isFinite(value) || value <= 0) {
    const { AppError } = require('../../core/errors/app_error');
    throw new AppError('A user, direction and a positive amount are required.', 400, 'INVALID_ADJUSTMENT');
  }
  if (direction !== 'deposit' && direction !== 'withdraw') {
    const { AppError } = require('../../core/errors/app_error');
    throw new AppError('Direction must be deposit or withdraw.', 400, 'INVALID_DIRECTION');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT id, role, balance FROM users
        WHERE id = $1
        FOR UPDATE`,
      [userId],
    );
    if (userRows.length === 0) {
      const { AppError } = require('../../core/errors/app_error');
      throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
    }

    const current = parseFloat(userRows[0].balance) || 0;
    const delta = direction === 'deposit' ? value : -value;

    if (direction === 'withdraw' && current < value) {
      const { AppError } = require('../../core/errors/app_error');
      throw new AppError(
        `Insufficient balance. Available: ETB ${current.toFixed(2)}.`,
        400,
        'INSUFFICIENT_BALANCE',
      );
    }

    const { rows: updated } = await client.query(
      `UPDATE users SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING balance`,
      [delta, userId],
    );

    const type = direction === 'deposit' ? 'ADMIN_DEPOSIT' : 'ADMIN_WITHDRAW';
    const title = direction === 'deposit' ? 'Admin deposit' : 'Admin withdrawal';
    const description = note && note.trim() ? note.trim() : null;

    const { rows: txn } = await client.query(
      `INSERT INTO wallet_transactions
         (user_id, title, description, amount, type, status, metadata)
       VALUES ($1, $2, $3, $4, $5, 'COMPLETED', $6)
       RETURNING id, amount, type, status, created_at`,
      [
        userId,
        title,
        description,
        delta,
        type,
        JSON.stringify({ adminId: adminId || null, note: description }),
      ],
    );

    await client.query('COMMIT');

    return {
      userId,
      direction,
      amount: value,
      newBalance: parseFloat(updated[0].balance) || 0,
      transaction: {
        id: txn[0].id,
        amount: parseFloat(txn[0].amount),
        type: txn[0].type,
        status: txn[0].status,
        createdAt: txn[0].created_at,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Coin → balance conversion rate (coins per 1 ETB). Stored in coin_settings
 * so admins can change it; referral coin conversion reads the same value.
 */
async function getCoinRate() {
  try {
    const { rows } = await pool.query(
      `SELECT coins_per_unit, conversion_enabled, updated_at
         FROM coin_settings WHERE id = 'default'`,
    );
    return {
      coinsPerUnit: parseFloat(rows[0]?.coins_per_unit) || 100,
      conversionEnabled: rows[0]?.conversion_enabled !== false,
      updatedAt: rows[0]?.updated_at ?? null,
    };
  } catch {
    // Table may not exist yet on an older deployment — fall back to default.
    return { coinsPerUnit: 100, conversionEnabled: true, updatedAt: null };
  }
}

async function setCoinRate(coinsPerUnit) {
  const rate = parseFloat(coinsPerUnit);
  if (!Number.isFinite(rate) || rate <= 0) {
    const err = new Error('coinsPerUnit must be a positive number');
    err.status = 400;
    throw err;
  }
  const { rows } = await pool.query(
    `INSERT INTO coin_settings (id, coins_per_unit, updated_at)
     VALUES ('default', $1, NOW())
     ON CONFLICT (id) DO UPDATE SET coins_per_unit = $1, updated_at = NOW()
     RETURNING coins_per_unit, updated_at`,
    [rate],
  );
  return { coinsPerUnit: parseFloat(rows[0].coins_per_unit), updatedAt: rows[0].updated_at };
}

async function updateCoinSettings({ coinsPerUnit, conversionEnabled } = {}) {
  const rate = coinsPerUnit !== undefined ? parseFloat(coinsPerUnit) : null;
  if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
    const err = new Error('coinsPerUnit must be a positive number');
    err.status = 400;
    throw err;
  }
  const enabled = conversionEnabled !== undefined ? !!conversionEnabled : null;
  const { rows } = await pool.query(
    `INSERT INTO coin_settings (id, coins_per_unit, conversion_enabled, updated_at)
     VALUES ('default', COALESCE($1, 100), COALESCE($2, true), NOW())
     ON CONFLICT (id) DO UPDATE SET
       coins_per_unit = COALESCE($1, coin_settings.coins_per_unit),
       conversion_enabled = COALESCE($2, coin_settings.conversion_enabled),
       updated_at = NOW()
     RETURNING coins_per_unit, conversion_enabled, updated_at`,
    [rate, enabled],
  );
  return {
    coinsPerUnit: parseFloat(rows[0].coins_per_unit),
    conversionEnabled: rows[0].conversion_enabled !== false,
    updatedAt: rows[0].updated_at,
  };
}

module.exports = { getTransactions, getUsers, getSummary, adjustBalance, getCoinRate, setCoinRate, updateCoinSettings };
