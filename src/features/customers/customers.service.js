const { pool } = require('../../core/config/database');

/**
 * List all customers (ROLE = 'CUSTOMER') with optional search & filter.
 */
async function listCustomers({ search = '', status = 'all', page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;

  let where = `u.role = 'CUSTOMER'`;
  const params = [];
  let idx = 1;

  if (search) {
    where += ` AND (u.phone ILIKE $${idx} OR cp.full_name ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }

  if (status === 'active') {
    where += ` AND u.is_active = true`;
  } else if (status === 'blocked') {
    where += ` AND u.is_active = false`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM users u
     LEFT JOIN customer_user cp ON cp.user_id = u.id
     WHERE ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.phone,
       u.is_active,
       u.balance,
       u.coins,
       u.created_at,
       COALESCE(cp.full_name, '') AS full_name,
       COALESCE(cp.avatar_url, '') AS avatar_url,
       COUNT(DISTINCT o.id)::int    AS total_orders,
       COALESCE(SUM(o.total_amount), 0)::numeric AS total_spent
     FROM users u
     LEFT JOIN customer_user cp ON cp.user_id = u.id
     LEFT JOIN orders o ON o.user_id = u.id
     WHERE ${where}
     GROUP BY u.id, cp.full_name, cp.avatar_url
     ORDER BY u.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  return {
    customers: rows.map((r) => ({
      id:          r.id,
      fullName:    r.full_name || 'Unknown',
      phone:       r.phone,
      isActive:    r.is_active,
      balance:     parseFloat(r.balance) || 0,
      coins:       r.coins || 0,
      totalOrders: r.total_orders,
      totalSpent:  parseFloat(r.total_spent) || 0,
      joinedAt:    r.created_at,
      avatarUrl:   r.avatar_url || null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get single customer by ID.
 */
async function getCustomer(id) {
  const { rows } = await pool.query(
    `SELECT
       u.id, u.phone, u.is_active, u.balance, u.coins, u.created_at,
       COALESCE(cp.full_name, '') AS full_name,
       COALESCE(cp.avatar_url, '') AS avatar_url,
       COUNT(DISTINCT o.id)::int AS total_orders,
       COALESCE(SUM(o.total_amount), 0)::numeric AS total_spent
     FROM users u
     LEFT JOIN customer_user cp ON cp.user_id = u.id
     LEFT JOIN orders o ON o.user_id = u.id
     WHERE u.id = $1 AND u.role = 'CUSTOMER'
     GROUP BY u.id, cp.full_name, cp.avatar_url`,
    [id]
  );

  if (rows.length === 0) return null;
  const r = rows[0];

  return {
    id:          r.id,
    fullName:    r.full_name || 'Unknown',
    phone:       r.phone,
    isActive:    r.is_active,
    balance:     parseFloat(r.balance) || 0,
    coins:       r.coins || 0,
    totalOrders: r.total_orders,
    totalSpent:  parseFloat(r.total_spent) || 0,
    joinedAt:    r.created_at,
    avatarUrl:   r.avatar_url || null,
  };
}

/**
 * Block or unblock a customer.
 */
async function setCustomerBlock(id, block) {
  const { rowCount } = await pool.query(
    `UPDATE users SET is_active = $1, updated_at = NOW()
     WHERE id = $2 AND role = 'CUSTOMER'`,
    [!block, id]
  );
  return rowCount > 0;
}

module.exports = { listCustomers, getCustomer, setCustomerBlock };
