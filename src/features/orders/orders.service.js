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
      INSERT INTO orders (user_id, total_cents, status, shipping_address, payment_method)
      VALUES ($1, $2, 'PENDING', $3, $4)
      RETURNING *
    `, [userId, totalCents, shippingAddress, paymentMethod]);

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
      COUNT(oi.id) as item_count
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.user_id = $1
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT $2 OFFSET $3
  `, [userId, limit, offset]);

  return rows;
}

// ── Get Order by ID ───────────────────────────────────────────────────────

async function getOrderById(orderId, userId) {
  const { rows } = await pool.query(`
    SELECT * FROM orders WHERE id = $1 AND user_id = $2
  `, [orderId, userId]);

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
  getOrderById,
};
