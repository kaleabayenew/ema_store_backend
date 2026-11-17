const crypto = require('crypto');
const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');

// ─────────────────────────────────────────────────────────────────────────────
//  Schema (idempotent, runs once per process)
//  - delivery_agents : registered delivery people. `agent_code` is the value
//                      printed in the QR code of the agent's ID card.
//  - orders.*        : delivery id, assigned agent and hand-over record.
// ─────────────────────────────────────────────────────────────────────────────

let schemaPromise = null;

function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS delivery_agents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_code VARCHAR(40) UNIQUE NOT NULL,
          full_name VARCHAR(255) NOT NULL,
          phone VARCHAR(30),
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_code VARCHAR(20)`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_agent_id UUID`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS handed_over_at TIMESTAMP`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS handover_code VARCHAR(20)`);
      await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_accepted_at TIMESTAMP`);
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_delivery_code
         ON orders(delivery_code) WHERE delivery_code IS NOT NULL`,
      );
    })().catch((err) => {
      schemaPromise = null; // retry on the next request
      throw err;
    });
  }
  return schemaPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** +251912345676 → +2519*****6 (the partner never receives the full number). */
function maskPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0') && d.length === 10) d = `251${d.slice(1)}`;
  else if (!d.startsWith('251')) d = `251${d}`;
  if (d.length < 6) return '***';
  return `+${d.slice(0, 4)}*****${d.slice(-1)}`;
}

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomCode(prefix, length) {
  const bytes = crypto.randomBytes(length);
  let out = prefix;
  for (let i = 0; i < length; i++) out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return out;
}

/** Accepts raw QR content such as "ABC123" or "EMA-AGENT:ABC123". */
function normalizeAgentCode(raw) {
  let code = String(raw || '').trim();
  if (code.includes(':')) code = code.split(':').pop().trim();
  return code.toUpperCase().slice(0, 40);
}

/** Gives the order a delivery id the first time it is needed. */
async function ensureDeliveryCode(client, orderId) {
  const { rows } = await client.query(`SELECT delivery_code FROM orders WHERE id = $1`, [orderId]);
  if (rows[0]?.delivery_code) return rows[0].delivery_code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode('D', 8);
    try {
      const res = await client.query(
        `UPDATE orders SET delivery_code = $1
         WHERE id = $2 AND delivery_code IS NULL RETURNING delivery_code`,
        [code, orderId],
      );
      if (res.rows[0]) return res.rows[0].delivery_code;
      const again = await client.query(`SELECT delivery_code FROM orders WHERE id = $1`, [orderId]);
      return again.rows[0]?.delivery_code || code;
    } catch (err) {
      if (err.code !== '23505') throw err; // unique collision → try another code
    }
  }
  throw new AppError('Could not create a delivery id.', 500, 'DELIVERY_CODE_FAILED');
}

/** Only this partner's items, with the product name and first image. */
async function loadItems(orderIds, partnerId) {
  if (orderIds.length === 0) return {};
  const { rows } = await pool.query(
    `SELECT oi.order_id, oi.product_id, oi.quantity,
            p.name_en AS name, img.image_url
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN LATERAL (
       SELECT pi.image_url FROM product_images pi
       WHERE pi.product_id = p.id
       ORDER BY pi.is_primary DESC, pi.sort_order, pi.created_at
       LIMIT 1
     ) img ON true
     WHERE oi.order_id = ANY($1::uuid[]) AND p.partner_id = $2
     ORDER BY oi.created_at`,
    [orderIds, partnerId],
  );
  const byOrder = {};
  for (const r of rows) {
    (byOrder[r.order_id] ||= []).push({
      product_id: r.product_id,
      name: r.name || '',
      image_url: r.image_url || null,
      quantity: Number(r.quantity) || 0,
    });
  }
  return byOrder;
}

/**
 * Single order shape sent to the partner app.
 * Deliberately has NO shipping address and NO full customer phone.
 */
function mapOrder(row, items = []) {
  return {
    id: row.id,
    status: row.status,
    total_amount: Number(row.total_amount) || 0,
    payment_method: row.payment_method || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    customer_name: row.customer_name || 'Customer',
    customer_phone: maskPhone(row.customer_phone),
    item_count: items.length
      ? items.reduce((n, i) => n + i.quantity, 0)
      : Number(row.item_count) || 0,
    delivery_code: row.delivery_code || null,
    handover_code: row.handover_code || null,
    handed_over_at: row.handed_over_at || null,
    delivery_agent: row.agent_code
      ? {
          code: row.agent_code,
          name: row.agent_name || '',
          phone: maskPhone(row.agent_phone),
        }
      : null,
    items,
  };
}

const ORDER_SELECT = `
  orders.id, orders.total_amount, orders.status, orders.payment_method,
  orders.created_at, orders.updated_at,
  orders.delivery_code, orders.handover_code, orders.handed_over_at,
  COALESCE(u.full_name, 'Customer') AS customer_name,
  u.phone AS customer_phone,
  da.agent_code, da.full_name AS agent_name, da.phone AS agent_phone`;

const ORDER_JOINS = `
  FROM orders
  JOIN order_items ON order_items.order_id = orders.id
  JOIN products ON products.id = order_items.product_id
  LEFT JOIN users u ON u.id = orders.user_id
  LEFT JOIN delivery_agents da ON da.id = orders.delivery_agent_id`;

// ─────────────────────────────────────────────────────────────────────────────
//  Queries
// ─────────────────────────────────────────────────────────────────────────────

async function getOrders(partnerId, { page = 1, limit = 50, status } = {}) {
  await ensureSchema();
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
      `SELECT ${ORDER_SELECT},
              COALESCE(SUM(order_items.quantity), 1)::int AS item_count
       ${ORDER_JOINS}
       WHERE products.partner_id = $1 ${statusClause}
       GROUP BY orders.id, u.id, da.id
       ORDER BY orders.created_at DESC
       LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
      queryParams,
    ),
  ]);

  const itemsByOrder = await loadItems(rowsRes.rows.map((r) => r.id), partnerId);
  return {
    orders: rowsRes.rows.map((r) => mapOrder(r, itemsByOrder[r.id] || [])),
    total: countRes.rows[0]?.total ?? 0,
    page,
    limit,
  };
}

async function fetchOrder(partnerId, orderId) {
  const { rows } = await pool.query(
    `SELECT ${ORDER_SELECT}
     ${ORDER_JOINS}
     WHERE orders.id = $1 AND products.partner_id = $2
     GROUP BY orders.id, u.id, da.id`,
    [orderId, partnerId],
  );
  if (rows.length === 0) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  const items = (await loadItems([orderId], partnerId))[orderId] || [];
  return mapOrder(rows[0], items);
}

async function getOrder(partnerId, orderId) {
  await ensureSchema();
  return fetchOrder(partnerId, orderId);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Status changes made by the partner
//    New → Accept (CONFIRMED) or Reject (CANCELLED) → PACKED
//    PACKED → SHIPPED happens ONLY through the hand-over (scan) endpoints.
// ─────────────────────────────────────────────────────────────────────────────

const PARTNER_ALLOWED_STATUSES = ['CONFIRMED', 'PACKED', 'CANCELLED'];

const PARTNER_TRANSITIONS = {
  PENDING:    ['CONFIRMED', 'CANCELLED'],
  PAID:       ['CONFIRMED', 'CANCELLED'],
  PLACED:     ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:  ['PACKED', 'CANCELLED'],
  PROCESSING: ['PACKED', 'CANCELLED'],
  PACKED:     ['CANCELLED'],
};

async function lockPartnerOrder(client, partnerId, orderId) {
  const { rows } = await client.query(
    `SELECT orders.id, orders.status, orders.delivery_agent_id
     FROM orders
     WHERE orders.id = $1
       AND EXISTS (
         SELECT 1 FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = orders.id AND p.partner_id = $2
       )
     FOR UPDATE`,
    [orderId, partnerId],
  );
  if (rows.length === 0) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  return rows[0];
}

async function updateStatus(partnerId, orderId, status) {
  await ensureSchema();
  const next = String(status || '').toUpperCase();

  if (next === 'SHIPPED' || next === 'IN_TRANSIT') {
    throw new AppError(
      'Use "Out from the shop" and scan the delivery person ID to hand the order over.',
      400,
      'USE_HANDOVER',
    );
  }
  if (!PARTNER_ALLOWED_STATUSES.includes(next)) {
    throw new AppError(
      `Invalid status. Allowed values: ${PARTNER_ALLOWED_STATUSES.join(', ')}.`,
      400,
      'INVALID_STATUS',
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await lockPartnerOrder(client, partnerId, orderId);
    const prev = String(order.status || '').toUpperCase();
    const allowed = PARTNER_TRANSITIONS[prev] || [];
    if (!allowed.includes(next)) {
      throw new AppError(
        `Cannot move order from ${prev} to ${next}.`,
        400,
        'INVALID_STATUS_TRANSITION',
      );
    }
    await client.query(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
      [next, orderId],
    );
    // The delivery id is created as soon as the partner accepts the order.
    if (next === 'CONFIRMED') await ensureDeliveryCode(client, orderId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return fetchOrder(partnerId, orderId);
}

/** Partner picks how the customer pays (cash, telebirr, bank, ...). */
async function updatePaymentMethod(partnerId, orderId, paymentMethod) {
  await ensureSchema();
  const method = String(paymentMethod || '').trim();
  if (!method) {
    throw new AppError('paymentMethod is required.', 400, 'MISSING_FIELDS');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockPartnerOrder(client, partnerId, orderId);
    await client.query(
      `UPDATE orders SET payment_method = $1, updated_at = NOW() WHERE id = $2`,
      [method.slice(0, 100), orderId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return fetchOrder(partnerId, orderId);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hand-over to the delivery person ("Out from the shop")
// ─────────────────────────────────────────────────────────────────────────────

async function findAgent(client, rawCode) {
  const code = normalizeAgentCode(rawCode);
  if (!code) throw new AppError('Delivery ID is required.', 400, 'MISSING_FIELDS');
  const { rows } = await client.query(
    `SELECT id, agent_code, full_name, phone, is_active
     FROM delivery_agents WHERE agent_code = $1`,
    [code],
  );
  const agent = rows[0];
  if (!agent) throw new AppError('Delivery person ID not recognised.', 404, 'AGENT_NOT_FOUND');
  if (agent.is_active === false) {
    throw new AppError('This delivery person is not active.', 403, 'AGENT_INACTIVE');
  }
  return agent;
}

/** Step 1 — after scanning: shows who is collecting what. Changes nothing. */
async function previewHandover(partnerId, orderId, agentCode) {
  await ensureSchema();
  const order = await fetchOrder(partnerId, orderId);
  if (String(order.status).toUpperCase() !== 'PACKED') {
    throw new AppError(
      'Only packed orders can be handed to a delivery person.',
      400,
      'ORDER_NOT_PACKED',
    );
  }
  const client = await pool.connect();
  try {
    const agent = await findAgent(client, agentCode);
    return {
      agent: { code: agent.agent_code, name: agent.full_name, phone: maskPhone(agent.phone) },
      order,
    };
  } finally {
    client.release();
  }
}

/** Step 2 — partner confirms: order becomes SHIPPED and a hand-over id is issued. */
async function confirmHandover(partnerId, orderId, agentCode) {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await lockPartnerOrder(client, partnerId, orderId);
    const agent = await findAgent(client, agentCode);
    const current = String(order.status || '').toUpperCase();

    // Already handed over to this same person → just return the record.
    if (current === 'SHIPPED' && order.delivery_agent_id === agent.id) {
      await client.query('COMMIT');
      return fetchOrder(partnerId, orderId);
    }
    if (current !== 'PACKED') {
      throw new AppError(
        'Only packed orders can be handed to a delivery person.',
        400,
        'ORDER_NOT_PACKED',
      );
    }

    await ensureDeliveryCode(client, orderId);

    const handoverCode = randomCode('H', 6);
    await client.query(
      `UPDATE orders
       SET status = 'SHIPPED', delivery_agent_id = $1, handed_over_at = NOW(),
           handover_code = $2, delivery_accepted_at = NULL, updated_at = NOW()
       WHERE id = $3`,
      [agent.id, handoverCode, orderId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return fetchOrder(partnerId, orderId);
}

module.exports = {
  getOrders,
  getOrder,
  updateStatus,
  updatePaymentMethod,
  previewHandover,
  confirmHandover,
};