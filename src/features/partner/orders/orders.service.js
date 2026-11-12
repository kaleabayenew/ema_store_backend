const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');

async function getOrders(partnerId, { page = 1, limit = 50, status } = {}) {
  const offset = (page - 1) * limit;
  const countParams = [partnerId];
  let statusClause = '';

  if (status) {
    countParams.push(String(status).toUpperCase());
    statusClause = `AND orders.status = $${countParams.length}`;
  }

  const queryParams = [...countParams, limit, offset];

  const [countRes, rowsRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT orders.id)::int AS total
       FROM orders
       JOIN order_items ON order_items.order_id = orders.id
       JOIN products ON products.id = order_items.product_id
       WHERE products.partner_id = $1 ${statusClause}`,
      countParams,
    ),
    pool.query(
      `SELECT 
         orders.id,
         orders.total_amount,
         orders.status,
         orders.shipping_address,
         orders.payment_method,
         orders.created_at,
         orders.updated_at,
         COALESCE(u.full_name, u.phone, 'Customer') AS customer_name,
         COALESCE(SUM(order_items.quantity), 1)::int AS item_count
       FROM orders
       JOIN order_items ON order_items.order_id = orders.id
       JOIN products ON products.id = order_items.product_id
       LEFT JOIN users u ON u.id = orders.user_id
       WHERE products.partner_id = $1 ${statusClause}
       GROUP BY orders.id, u.full_name, u.phone
       ORDER BY orders.created_at DESC
       LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
      queryParams,
    ),
  ]);

  return { orders: rowsRes.rows, total: countRes.rows[0]?.total ?? 0, page, limit };
}

async function getOrder(partnerId, orderId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT orders.*
     FROM orders
     JOIN order_items ON order_items.order_id = orders.id
     JOIN products ON products.id = order_items.product_id
     WHERE orders.id = $1 AND products.partner_id = $2`,
    [orderId, partnerId],
  );
  if (rows.length === 0) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

  const order = rows[0];

  const { rows: items } = await pool.query(
    `SELECT order_items.*, products.name_en, products.partner_id
     FROM order_items
     JOIN products ON products.id = order_items.product_id
     WHERE order_items.order_id = $1 AND products.partner_id = $2`,
    [orderId, partnerId],
  );

  return { ...order, items };
}

const PARTNER_ALLOWED_STATUSES = ['CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED'];

async function updateStatus(partnerId, orderId, status) {
  if (!status || !PARTNER_ALLOWED_STATUSES.includes(String(status).toUpperCase())) {
    throw new AppError(
      `Invalid status. Allowed values: ${PARTNER_ALLOWED_STATUSES.join(', ')}.`,
      400,
      'INVALID_STATUS',
    );
  }
  const normalizedStatus = String(status).toUpperCase();

  // Verify this order contains at least one of the partner's products
  const { rows } = await pool.query(
    `SELECT orders.id FROM orders
     JOIN order_items ON order_items.order_id = orders.id
     JOIN products ON products.id = order_items.product_id
     WHERE orders.id = $1 AND products.partner_id = $2
     LIMIT 1`,
    [orderId, partnerId],
  );
  if (rows.length === 0) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

  const { rows: updated } = await pool.query(
    `UPDATE orders SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [normalizedStatus, orderId],
  );
  return updated[0];
}

module.exports = { getOrders, getOrder, updateStatus };
