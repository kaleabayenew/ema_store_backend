const { ok } = require('../../core/utils/response');
const { AppError } = require('../../core/errors/app_error');
const { pool } = require('../../core/config/database');

// ── GET /api/v1/admin/orders
// Query: ?search=&status=&page=&limit=

async function getAllOrders(req, res, next) {
  try {
    const { search, status } = req.query;
    const limit  = parseInt(req.query.limit) || 15;
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * limit;

    const params = [];
    let where = 'WHERE 1=1';
    let idx = 1;

    if (search) {
      where += ` AND (CAST(o.id AS TEXT) ILIKE $${idx} OR cu.full_name ILIKE $${idx} OR u.phone ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    if (status) {
      where += ` AND o.status = $${idx}`;
      params.push(status);
      idx++;
    }

    // Aggregates
    const aggRes = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE o.status = 'DELIVERED')::int AS delivered,
         COUNT(*) FILTER (WHERE o.status IN ('PLACED','CONFIRMED','PROCESSING','PACKED','SHIPPED','IN_TRANSIT'))::int AS in_transit,
         COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
         COALESCE(SUM(o.total_amount), 0)::numeric AS total_revenue
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN customer_user cu ON cu.user_id = o.user_id
       ${where}`,
      params,
    );
    const { total, delivered, in_transit, cancelled, total_revenue } = aggRes.rows[0];

    // Page data
    const { rows } = await pool.query(
      `SELECT
         o.id,
         o.status,
         o.total_amount,
         o.shipping_address,
         o.payment_method,
         o.created_at,
         o.updated_at,
         COALESCE(cu.full_name, u.phone) AS customer_name,
         u.phone                         AS customer_phone,
         COUNT(oi.id)::int               AS item_count
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN customer_user cu ON cu.user_id = o.user_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       ${where}
       GROUP BY o.id, cu.full_name, u.phone
       ORDER BY o.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    );

    const orders = rows.map((r) => ({
      id:              r.id,
      status:          r.status,
      totalAmount:     parseFloat(r.total_amount) || 0,
      shippingAddress: r.shipping_address ?? '—',
      paymentMethod:   r.payment_method ?? '—',
      customerName:    r.customer_name ?? 'Unknown',
      customerPhone:   r.customer_phone ?? '',
      itemCount:       r.item_count ?? 0,
      createdAt:       r.created_at,
      updatedAt:       r.updated_at,
    }));

    ok(res, {
      orders,
      total: parseInt(total),
      page,
      limit,
      totalPages:   Math.max(1, Math.ceil(parseInt(total) / limit)),
      delivered:    parseInt(delivered),
      inTransit:    parseInt(in_transit),
      cancelled:    parseInt(cancelled),
      totalRevenue: parseFloat(total_revenue) || 0,
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/v1/admin/orders/:id  (detail with items)

async function getOrderById(req, res, next) {
  try {
    const { rows: orderRows } = await pool.query(
      `SELECT
         o.*,
         COALESCE(cu.full_name, u.phone) AS customer_name,
         u.phone AS customer_phone,
         u.email AS customer_email
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN customer_user cu ON cu.user_id = o.user_id
       WHERE o.id = $1`,
      [req.params.id],
    );
    if (orderRows.length === 0) return next(new AppError('Order not found', 404, 'NOT_FOUND'));

    const { rows: itemRows } = await pool.query(
      `SELECT
         oi.id, oi.quantity, oi.price_at_order,
         p.name_en AS product_name,
         pi.image_url AS product_image
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN product_images pi ON pi.product_id = oi.product_id AND pi.is_primary = true
       WHERE oi.order_id = $1`,
      [req.params.id],
    );

    const o = orderRows[0];
    ok(res, {
      order: {
        id:              o.id,
        status:          o.status,
        totalAmount:     parseFloat(o.total_amount) || 0,
        shippingAddress: o.shipping_address ?? '—',
        paymentMethod:   o.payment_method ?? '—',
        customerName:    o.customer_name ?? 'Unknown',
        customerPhone:   o.customer_phone ?? '',
        customerEmail:   o.customer_email ?? '',
        createdAt:       o.created_at,
        updatedAt:       o.updated_at,
        items: itemRows.map((i) => ({
          id:           i.id,
          productName:  i.product_name ?? 'Unknown product',
          productImage: i.product_image ?? null,
          quantity:     i.quantity,
          priceAtOrder: parseFloat(i.price_at_order) || 0,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/v1/admin/orders/:id/status

async function updateOrderStatus(req, res, next) {
  try {
    const { status } = req.body;
    const validStatuses = ['PLACED', 'CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }
    const { rowCount } = await pool.query(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, req.params.id],
    );
    if (rowCount === 0) return next(new AppError('Order not found', 404, 'NOT_FOUND'));
    ok(res, { message: `Order status updated to ${status}` });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAllOrders, getOrderById, updateOrderStatus };
