const crypto = require('crypto');
const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');
const {
  ensureOrderFlowSchema,
  maskPhone,
  safeSendNotification,
} = require('../../orders/order_flow');
const { resolveAgentDisplayCode } = require('../../delivery/agent_qr');
const { getOfferAcceptanceBlock } = require('../../delivery/offer_rules');

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

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
     WHERE oi.order_id = ANY($1::uuid[])
     ORDER BY oi.created_at`,
    [orderIds],
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
 * Deliberately has NO customer detail (no name, no phone, no address).
 */
function mapOrder(row, items = []) {
  return {
    id: row.id,
    status: row.status,
    total_amount: Number(row.total_amount) || 0,
    payment_method: row.payment_method || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Step 2: Customer privacy — no name, no phone, no address sent to partner
    customer_name: null,
    customer_phone: null,
    customer_address: null,
    item_count: items.length
      ? items.reduce((n, i) => n + i.quantity, 0)
      : Number(row.item_count) || 0,
    delivery_code: row.delivery_code || null,
    handover_code: row.handover_code || null,
    handed_over_at: row.handed_over_at || null,
    handover_requested_at: row.handover_requested_at || null,
    handover_proof: row.handover_proof || null,
    delivery_requested_at: row.delivery_requested_at || null,
    customer_rejected_at: row.customer_rejected_at || null,
    delivered_at: row.delivered_at || null,
    payment_status: row.payment_status || 'PENDING',
    // Step 4: When rider accepts, partner sees delivery person info
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
  orders.handover_requested_at, orders.handover_proof,
  orders.delivery_requested_at, orders.delivered_at, orders.customer_accepted_at, orders.customer_rejected_at,
  orders.payment_status, orders.delivery_agent_id,
  da.agent_code, da.full_name AS agent_name, da.phone AS agent_phone`;

const ORDER_JOINS = `
  FROM orders
  JOIN order_items ON order_items.order_id = orders.id
  JOIN products ON products.id = order_items.product_id
  LEFT JOIN delivery_agents da ON da.id = orders.delivery_agent_id`;

// ─────────────────────────────────────────────────────────────────────────────
//  Queries
// ─────────────────────────────────────────────────────────────────────────────

async function getOrders(partnerId, { page = 1, limit = 50, status } = {}) {
  await ensureOrderFlowSchema();
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
       GROUP BY orders.id, da.id, da.agent_code, da.full_name, da.phone
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
     GROUP BY orders.id, da.id, da.agent_code, da.full_name, da.phone`,
    [orderId, partnerId],
  );
  if (rows.length === 0) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  const items = (await loadItems([orderId], partnerId))[orderId] || [];
  return mapOrder(rows[0], items);
}

async function getOrder(partnerId, orderId) {
  await ensureOrderFlowSchema();
  return fetchOrder(partnerId, orderId);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Status changes made by the partner
// ─────────────────────────────────────────────────────────────────────────────

const PARTNER_ALLOWED_STATUSES = ['CONFIRMED', 'PACKED'];

async function lockPartnerOrder(client, partnerId, orderId) {
  const { rows } = await client.query(
    `SELECT orders.id, orders.status, orders.delivery_agent_id,
            orders.payment_status, orders.payment_method
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

function notifyRidersOfNewOffer(orderId) {
  require('../../delivery/delivery.service')
    .notifyRidersOfNewOffer(orderId)
    .catch((err) =>
      console.error('[notify] Rider offer notification failed:', err.message || err),
    );
}

async function updateStatus(partnerId, orderId, status) {
  await ensureOrderFlowSchema();
  const next = String(status || '').toUpperCase();

  // Step 1: Partner cannot reject or cancel
  if (next === 'CANCELLED' || next === 'REJECTED') {
    throw new AppError(
      'Partners cannot reject confirmed orders.',
      403,
      'PARTNER_CANNOT_REJECT',
    );
  }

  if (next === 'SHIPPED' || next === 'IN_TRANSIT') {
    throw new AppError(
      'Use "Pick up" and scan the delivery person ID to hand the order over.',
      400,
      'USE_HANDOVER',
    );
  }

  if (!PARTNER_ALLOWED_STATUSES.includes(next)) {
    throw new AppError(
      `Invalid status. Partner can only mark orders as PACKED.`,
      400,
      'INVALID_STATUS',
    );
  }

  const client = await pool.connect();
  let shouldNotifyRiders = false;
  try {
    await client.query('BEGIN');
    const order = await lockPartnerOrder(client, partnerId, orderId);
    shouldNotifyRiders =
      !order.delivery_agent_id &&
      Boolean(getOfferAcceptanceBlock(order)) &&
      !getOfferAcceptanceBlock({ ...order, status: next });
    await client.query(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
      [next, orderId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  if (shouldNotifyRiders) notifyRidersOfNewOffer(orderId);
  return fetchOrder(partnerId, orderId);
}

/** Partner picks how the customer pays (cash, telebirr, bank, ...). */
async function updatePaymentMethod(partnerId, orderId, paymentMethod) {
  await ensureOrderFlowSchema();
  const method = String(paymentMethod || '').trim();
  if (!method) {
    throw new AppError('paymentMethod is required.', 400, 'MISSING_FIELDS');
  }
  const client = await pool.connect();
  let shouldNotifyRiders = false;
  try {
    await client.query('BEGIN');
    const order = await lockPartnerOrder(client, partnerId, orderId);
    shouldNotifyRiders =
      !order.delivery_agent_id &&
      Boolean(getOfferAcceptanceBlock(order)) &&
      !getOfferAcceptanceBlock({ ...order, payment_method: method });
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
  if (shouldNotifyRiders) notifyRidersOfNewOffer(orderId);
  return fetchOrder(partnerId, orderId);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hand-over to the delivery person
// ─────────────────────────────────────────────────────────────────────────────

async function findAgent(client, rawCode) {
  const code = normalizeAgentCode(rawCode);
  if (!code) throw new AppError('Delivery ID is required.', 400, 'MISSING_FIELDS');
  const selectAgent = `SELECT id, agent_code, full_name, phone, is_active
     FROM delivery_agents`;
  let { rows } = await client.query(
    `${selectAgent} WHERE agent_code = $1`,
    [code],
  );
  // Fallback: the partner may type the rider's phone number instead of the
  // agent code — match on the last 9 digits of the stored phone.
  if (!rows[0]) {
    const digits = code.replace(/\D/g, '');
    if (digits.length >= 9) {
      const last9 = digits.slice(-9);
      ({ rows } = await client.query(
        `${selectAgent} WHERE regexp_replace(COALESCE(phone,''), '\\D', '', 'g') LIKE '%' || $1`,
        [last9],
      ));
    }
  }
  let agent = rows[0];
  // Fallback: short 5-minute display ID shown on the rider QR screen.
  if (!agent) {
    const displayAgentId = await resolveAgentDisplayCode(code);
    if (displayAgentId) {
      const r = await client.query(
        `SELECT id, agent_code, full_name, phone, is_active
         FROM delivery_agents WHERE id = $1`,
        [displayAgentId],
      );
      agent = r.rows[0];
    }
  }
  if (!agent) {
    // A common mistake is scanning the order's delivery_code instead of the
    // rider's ID — detect it and explain.
    const { rows: orderHit } = await client.query(
      `SELECT 1 FROM orders WHERE delivery_code = $1 LIMIT 1`,
      [code],
    );
    if (orderHit.length > 0) {
      throw new AppError(
        'That is the order delivery code, not a rider ID. Ask the rider to show their QR code.',
        404,
        'ORDER_CODE_NOT_RIDER',
      );
    }
    throw new AppError(
      `Delivery person ID "${code}" not recognised. Scan the QR on the rider's ID card or type their agent code.`,
      404,
      'AGENT_NOT_FOUND',
    );
  }
  if (agent.is_active === false) {
    throw new AppError('This delivery person is not active.', 403, 'AGENT_INACTIVE');
  }
  return agent;
}

/**
 * Step 5b — Partner scans rider QR.
 * Backend verifies that this is the same rider who accepted THIS order.
 */
async function previewHandover(partnerId, orderId, agentCode) {
  await ensureOrderFlowSchema();
  const client = await pool.connect();
  try {
    const order = await lockPartnerOrder(client, partnerId, orderId);
    const agent = await findAgent(client, agentCode);

    if (!order.delivery_agent_id) {
      throw new AppError('No delivery person has accepted this order yet.', 400, 'NO_RIDER_YET');
    }

    if (order.delivery_agent_id !== agent.id) {
      throw new AppError('Scanned rider does not match the assigned rider for this order.', 400, 'WRONG_RIDER');
    }

    const fullOrder = await fetchOrder(partnerId, orderId);
    return {
      agent: { code: agent.agent_code, name: agent.full_name, phone: maskPhone(agent.phone) },
      order: fullOrder,
    };
  } finally {
    client.release();
  }
}

/**
 * Step 5c — Partner confirms handover with photo/video proofs.
 * Status remains PACKED (or moves CONFIRMED -> PACKED).
 * handover_requested_at is set, proof is stored.
 * Screen shows "Waiting for rider to confirm".
 */
async function confirmHandover(partnerId, orderId, agentCode, proof = []) {
  await ensureOrderFlowSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await lockPartnerOrder(client, partnerId, orderId);
    const agent = await findAgent(client, agentCode);

    if (!order.delivery_agent_id) {
      throw new AppError('No delivery person has accepted this order yet.', 400, 'NO_RIDER_YET');
    }

    if (order.delivery_agent_id !== agent.id) {
      throw new AppError('Scanned rider does not match the assigned rider for this order.', 400, 'WRONG_RIDER');
    }

    await ensureDeliveryCode(client, orderId);

    const handoverCode = randomCode('H', 6);
    const proofJson = JSON.stringify(Array.isArray(proof) ? proof : []);

    await client.query(
      `UPDATE orders
       SET status = 'PACKED',
           handover_code = $1,
           handover_requested_at = NOW(),
           handover_proof = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [handoverCode, proofJson, orderId],
    );
    await client.query('COMMIT');

    // Notify Rider
    const { rows: userAgentRows } = await pool.query(
      `SELECT u.id AS user_id FROM delivery_agents da
       JOIN users u ON u.phone = da.phone
       WHERE da.id = $1`,
      [agent.id],
    );
    if (userAgentRows[0]) {
      safeSendNotification(
        userAgentRows[0].user_id,
        'Handover Ready',
        'Partner has packed the order and requested handover. Please confirm receipt.',
        { orderId, type: 'HANDOVER_REQUESTED' }
      );
    }
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
