const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');

async function getOrders(partnerId, { page = 1, limit = 20, status } = {}) {
  const offset = (page - 1) * limit;
  const params = [partnerId];
  let statusClause = '';

  if (status) {
    params.push(status);
    statusClause = `AND orders.status = $${params.length}`;
  }

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(DISTINCT orders.id)::int AS total
     FROM orders
     JOIN order_items ON order_items.order_id = orders.id
     JOIN products ON products.id = order_items.product_id
     WHERE products.partner_id = $1 ${statusClause}`,
    params,
  );

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT DISTINCT orders.*
     FROM orders
     JOIN order_items ON order_items.order_id = orders.id
     JOIN products ON products.id = order_items.product_id
     WHERE products.partner_id = $1 ${statusClause}
     ORDER BY orders.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { orders: rows, total: countRows[0].total, page, limit };
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

const PARTNER_ALLOWED_STATUSES = ['CONFIRMED', 'PACKED', 'SHIPPED', 'CANCELLED'];

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
