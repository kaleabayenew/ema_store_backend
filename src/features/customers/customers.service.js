const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');
const bcrypt = require('bcryptjs');
const { sendPasswordReset: sendTelegramPassword } = require('../../core/services/telegram-bot.service');

/**
 * Generate a readable random password like "Ema@9XK2QF".
 */
function generateReadablePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let body = '';
  for (let i = 0; i < 6; i++) {
    body += chars[Math.floor(Math.random() * chars.length)];
  }
  return `Ema@${body}`;
}

/**
 * Normalize phone to canonical E.164 (+251XXXXXXXXX).
 */
function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('251') && digits.length === 12) {
    digits = digits.substring(3);
  } else if (digits.startsWith('0') && digits.length === 10) {
    digits = digits.substring(1);
  }
  return `+251${digits}`;
}

/**
 * Get the current readable password for a customer.
 */
async function getCustomerPassword(id) {
  const { rows } = await pool.query(
    `SELECT password_plain, phone FROM users WHERE id = $1 AND role = 'CUSTOMER'`,
    [id]
  );
  if (rows.length === 0) return null;
  return {
    password: rows[0].password_plain || null,
    phone:    rows[0].phone,
  };
}

/**
 * Generate a new password for a customer, persist it (hash + plain),
 * and send it to the customer via Telegram.
 */
async function resetCustomerPassword(id) {
  const { rows } = await pool.query(
    `SELECT phone FROM users WHERE id = $1 AND role = 'CUSTOMER'`,
    [id]
  );
  if (rows.length === 0) return null;

  const phone          = rows[0].phone;
  const canonicalPhone = normalizePhone(phone);
  const newPassword    = generateReadablePassword();
  const passwordHash   = await bcrypt.hash(newPassword, 12);

  await pool.query(
    `UPDATE users
       SET password_hash = $1, password_plain = $2, updated_at = NOW()
     WHERE id = $3`,
    [passwordHash, newPassword, id]
  );

  // Try to send via Telegram if the customer linked their account
  let delivery = { sent: false, note: 'Customer has not linked a Telegram account.' };
  const { rows: chatRows } = await pool.query(
    'SELECT chat_id FROM telegram_chat_ids WHERE phone = $1',
    [canonicalPhone]
  );

  if (chatRows.length > 0) {
    const result = await sendTelegramPassword(chatRows[0].chat_id, phone, newPassword);
    delivery = {
      sent:  result.success === true,
      note:  result.success
        ? 'New password sent to the customer on Telegram.'
        : (result.error || 'Failed to send via Telegram.'),
    };
  }

  return { newPassword, phone: canonicalPhone, delivery };
}

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
 * Get orders for a specific customer.
 */
async function getCustomerOrders(customerId) {
  const { rows } = await pool.query(
    `SELECT
       o.id,
       o.total_amount,
       o.status,
       o.shipping_address,
       o.created_at,
       o.updated_at,
       COALESCE(
         json_agg(
           json_build_object(
             'id',           oi.id,
             'productId',    oi.product_id,
             'productName',  p.name,
             'quantity',     oi.quantity,
             'price',        oi.price_at_order
           )
         ) FILTER (WHERE oi.id IS NOT NULL), '[]'
       ) AS items
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     LEFT JOIN products p    ON p.id = oi.product_id
     WHERE o.user_id = $1
     GROUP BY o.id
     ORDER BY o.created_at DESC`,
    [customerId]
  );

  return rows.map((r) => ({
    id:              r.id,
    totalAmount:     parseFloat(r.total_amount) || 0,
    status:          r.status,
    shippingAddress: r.shipping_address,
    createdAt:       r.created_at,
    updatedAt:       r.updated_at,
    items:           r.items || [],
  }));
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

module.exports = { listCustomers, getCustomer, getCustomerOrders, getCustomerPassword, resetCustomerPassword, setCustomerBlock };
