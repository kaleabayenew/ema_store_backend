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
 * Generate a new password for a customer, persist the hash only
 * (no plaintext is ever stored), and send it to the customer via Telegram.
 */
async function resetCustomerPassword(id) {
  const { rows } = await pool.query(
    `SELECT phone FROM users WHERE id = $1 AND role = 'CUSTOMER'`,
    [id]
  );
  if (rows.length === 0) return null;

  const phone = rows[0].phone;
  const canonicalPhone = normalizePhone(phone);
  const newPassword = generateReadablePassword();
  const passwordHash = await bcrypt.hash(newPassword, 12);

  await pool.query(
    `UPDATE users
       SET password_hash = $1, password_plain = NULL, updated_at = NOW()
     WHERE id = $2`,
    [passwordHash, id]
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
      sent: result.success === true,
      note: result.success
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
    where += ` AND (u.is_active = true AND (u.is_blocked IS NULL OR u.is_blocked = false))`;
  } else if (status === 'blocked') {
    where += ` AND (u.is_active = false OR u.is_blocked = true)`;
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
       COALESCE(u.is_blocked, false) AS is_blocked,
       u.block_reason,
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
      id: r.id,
      fullName: r.full_name || 'Unknown',
      phone: r.phone,
      isActive: r.is_active && !r.is_blocked,
      isBlocked: !!r.is_blocked,
      blockReason: r.block_reason || null,
      balance: parseFloat(r.balance) || 0,
      coins: r.coins || 0,
      totalOrders: r.total_orders,
      totalSpent: parseFloat(r.total_spent) || 0,
      joinedAt: r.created_at,
      avatarUrl: r.avatar_url || null,
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
       u.id, u.phone, u.is_active, COALESCE(u.is_blocked, false) AS is_blocked, u.block_reason,
       u.balance, u.coins, u.created_at,
       COALESCE(cp.full_name, '') AS full_name,
       COALESCE(cp.avatar_url, '') AS avatar_url,
       COUNT(DISTINCT o.id)::int AS total_orders,
       COALESCE(SUM(o.total_amount), 0)::numeric AS total_spent
     FROM users u
     LEFT JOIN customer_user cp ON cp.user_id = u.id
     LEFT JOIN orders o ON o.user_id = u.id
     WHERE u.id = $1 AND UPPER(u.role) = 'CUSTOMER'
     GROUP BY u.id, cp.full_name, cp.avatar_url`,
    [id]
  );

  if (rows.length === 0) return null;
  const r = rows[0];

  return {
    id: r.id,
    fullName: r.full_name || 'Unknown',
    phone: r.phone,
    isActive: r.is_active && !r.is_blocked,
    isBlocked: !!r.is_blocked,
    blockReason: r.block_reason || null,
    balance: parseFloat(r.balance) || 0,
    coins: r.coins || 0,
    totalOrders: r.total_orders,
    totalSpent: parseFloat(r.total_spent) || 0,
    joinedAt: r.created_at,
    avatarUrl: r.avatar_url || null,
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
    id: r.id,
    totalAmount: parseFloat(r.total_amount) || 0,
    status: r.status,
    shippingAddress: r.shipping_address,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    items: r.items || [],
  }));
}

/**
 * Block or unblock a customer.
 */
async function setCustomerBlock(id, block, reason = null) {
  const defaultReason = block
    ? 'Your account has been suspended by the administration. Please contact support.'
    : null;
  const { rowCount } = await pool.query(
    `UPDATE users
     SET is_active = $1,
         is_blocked = $2,
         block_reason = $3,
         updated_at = NOW()
     WHERE id = $4 AND UPPER(role) = 'CUSTOMER'`,
    [!block, block, block ? (reason || defaultReason) : null, id]
  );
  return rowCount > 0;
}

/**
 * Get customer profile for authenticated user.
 */
async function getCustomerProfile(userId) {
  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.phone,
       u.email,
       u.balance,
       u.coins,
       u.is_active,
       u.is_blocked,
       u.profile_image,
       COALESCE(cp.full_name, '') AS full_name,
       COALESCE(cp.avatar_url, u.profile_image) AS avatar_url,
       u.created_at
     FROM users u
     LEFT JOIN customer_user cp ON cp.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );

  if (rows.length === 0) {
    throw new AppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
  }

  const r = rows[0];

  return {
    id: r.id,
    phone: r.phone,
    email: r.email,
    fullName: r.full_name || '',
    profileImage: r.profile_image,
    avatarUrl: r.avatar_url,
    balance: parseFloat(r.balance) || 0,
    coins: r.coins || 0,
    isActive: r.is_active,
    isBlocked: r.is_blocked,
    createdAt: r.created_at,
    // Snake_case for compatibility
    full_name: r.full_name || '',
    avatar_url: r.avatar_url,
    profile_image: r.profile_image,
  };
}

/**
 * Update customer profile.
 */
async function updateCustomerProfile(userId, { fullName, avatarUrl, email }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update customer_user table
    if (fullName || avatarUrl) {
      await client.query(
        `INSERT INTO customer_user (user_id, full_name, avatar_url, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET full_name = COALESCE($2, customer_user.full_name),
             avatar_url = COALESCE($3, customer_user.avatar_url),
             updated_at = NOW()`,
        [userId, fullName || null, avatarUrl || null]
      );
    }

    // Update users table for avatar and email
    if (avatarUrl) {
      await client.query(
        `UPDATE users SET profile_image = $1 WHERE id = $2`,
        [avatarUrl, userId]
      );
    }

    if (email) {
      await client.query(
        `UPDATE users SET email = $1 WHERE id = $2`,
        [email, userId]
      );
    }

    await client.query('COMMIT');

    // Return updated profile
    return await getCustomerProfile(userId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  listCustomers,
  getCustomer,
  getCustomerOrders,
  resetCustomerPassword,
  setCustomerBlock,
  getCustomerProfile,
  updateCustomerProfile,
};
