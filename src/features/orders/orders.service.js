const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// ============================================================================
// ORDERS SERVICE
// Handles order creation and management
// ============================================================================

// ── Create Order from Cart ────────────────────────────────────────────────

async function createOrder(userId, shippingAddress, paymentMethod) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get cart items
    const { rows: cartItems } = await client.query(`
      SELECT ci.*, p.stock, p.price_cents, p.discount_cents
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = $1
    `, [userId]);

    if (cartItems.length === 0) {
      throw new AppError('Cart is empty', 400, 'EMPTY_CART');
    }

    // Check stock
    for (const item of cartItems) {
      if (item.stock < item.quantity) {
        throw new AppError(`Insufficient stock for product`, 400, 'INSUFFICIENT_STOCK');
      }
    }

    // Calculate total
    let totalCents = 0;
    for (const item of cartItems) {
      const price = item.discount_cents > 0 ? item.discount_cents : item.price_cents;
      totalCents += price * item.quantity;
    }

    // Create order
    const { rows: orderRows } = await client.query(`
      INSERT INTO orders (user_id, total_cents, total_amount, status, shipping_address, payment_method)
      VALUES ($1, $2, $3, 'PENDING', $4, $5)
      RETURNING *
    `, [userId, totalCents, totalCents / 100.0, shippingAddress, paymentMethod]);

    const order = orderRows[0];

    // Create order items and update stock
    for (const item of cartItems) {
      const price = item.discount_cents > 0 ? item.discount_cents : item.price_cents;

      await client.query(`
        INSERT INTO order_items (order_id, product_id, quantity, price_at_order)
        VALUES ($1, $2, $3, $4)
      `, [order.id, item.product_id, item.quantity, price]);

      await client.query(`
        UPDATE products
        SET stock = stock - $1, sold_count = sold_count + $1
        WHERE id = $2
      `, [item.quantity, item.product_id]);
    }

    // Clear cart
    await client.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);

    await client.query('COMMIT');

    return order;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Get User Orders ─────────────────────────────────────────────────────

async function getUserOrders(userId, limit = 20, offset = 0) {
  const { rows } = await pool.query(`
    SELECT
      o.*,
      COUNT(oi.id)::int as item_count
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.user_id = $1
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT $2 OFFSET $3
  `, [userId, limit, offset]);

  return rows;
}

// ── Get All Orders (Admin) ───────────────────────────────────────────────

async function getAllOrders({ page = 1, limit = 20, status, search } = {}) {
  const offset = (page - 1) * limit;
  let where = 'WHERE 1=1';
  const params = [];
  let idx = 1;

  if (status && status !== 'All') {
    where += ` AND o.status = $${idx}`;
    params.push(status);
    idx++;
  }

  if (search) {
    where += ` AND (o.id::text ILIKE $${idx} OR u.phone ILIKE $${idx} OR cu.full_name ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }

  const { rows: countRows } = await pool.query(`
    SELECT COUNT(DISTINCT o.id)::int AS total
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN customer_user cu ON cu.user_id = o.user_id
    ${where}
  `, params);
  const total = countRows[0]?.total ?? 0;

  const { rows } = await pool.query(`
    SELECT
      o.*,
      COALESCE(cu.full_name, u.phone, 'Customer') AS customer_name,
      u.phone AS customer_phone,
      COUNT(oi.id)::int AS item_count
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN customer_user cu ON cu.user_id = o.user_id
    LEFT JOIN order_items oi ON o.id = oi.order_id
    ${where}
    GROUP BY o.id, cu.full_name, u.phone
    ORDER BY o.created_at DESC
    LIMIT $${idx} OFFSET $${idx + 1}
  `, [...params, limit, offset]);

  return {
    orders: rows.map((r) => ({
      id: r.id,
      customer: r.customer_name,
      customerPhone: r.customer_phone,
      items: r.item_count,
      total: `ETB ${parseFloat(r.total_amount || (r.total_cents ? r.total_cents / 100 : 0)).toLocaleString()}`,
      totalCents: r.total_cents ?? Math.round(parseFloat(r.total_amount || 0) * 100),
      method: r.payment_method ?? 'Telebirr',
      status: r.status,
      date: new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      shippingAddress: r.shipping_address,
      createdAt: r.created_at,
    })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

// ── Update Order Status (Admin) ──────────────────────────────────────────

async function updateOrderStatus(orderId, status) {
  const { rows } = await pool.query(`
    UPDATE orders
    SET status = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `, [status, orderId]);

  if (rows.length === 0) {
    throw new AppError('Order not found', 404, 'NOT_FOUND');
  }

  return rows[0];
}

// ── Get Order by ID ───────────────────────────────────────────────────────

async function getOrderById(orderId, userId = null) {
  let query = 'SELECT * FROM orders WHERE id = $1';
  const params = [orderId];

  if (userId) {
    query += ' AND user_id = $2';
    params.push(userId);
  }

  const { rows } = await pool.query(query, params);

  if (rows.length === 0) {
    throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  }

  const order = rows[0];

  // Get order items
  const { rows: items } = await pool.query(`
    SELECT
      oi.*,
      p.name_en,
      p.name_am,
      p.name_om,
      pi.image_url
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = true
    WHERE oi.order_id = $1
  `, [orderId]);

  return { ...order, items };
}

module.exports = {
  createOrder,
  getUserOrders,
  getAllOrders,
  updateOrderStatus,
  getOrderById,
};
