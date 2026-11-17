const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');
const { encryptAgentCode } = require('./agent_qr');

// ─────────────────────────────────────────────────────────────────────────────
//  Delivery-agent offers
//  When a partner confirms a hand-over (orders.status = SHIPPED) the order
//  becomes an "offer" for that delivery agent. The agent's app polls
//  GET /api/v1/delivery/offers with their agent code, shows an accept /
//  reject popup, and calls accept or decline.
//
//  Accept  → order stays SHIPPED (delivery_accepted_at is stamped).
//  Decline → order goes back to PACKED so the partner can hand it to
//            someone else.
// ─────────────────────────────────────────────────────────────────────────────

let schemaPromise = null;

function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(
        `ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_accepted_at TIMESTAMP`,
      );
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

/** Accepts raw QR content such as "ABC123" or "EMA-AGENT:ABC123". */
function normalizeAgentCode(raw) {
  let code = String(raw || '').trim();
  if (code.includes(':')) code = code.split(':').pop().trim();
  return code.toUpperCase().slice(0, 40);
}

async function findAgent(code) {
  const normalized = normalizeAgentCode(code);
  if (!normalized) {
    throw new AppError('Delivery agent code is required.', 401, 'AGENT_CODE_REQUIRED');
  }
  const { rows } = await pool.query(
    `SELECT id, agent_code, full_name, phone, is_active
     FROM delivery_agents WHERE agent_code = $1`,
    [normalized],
  );
  const agent = rows[0];
  if (!agent) {
    throw new AppError('Delivery agent not recognised.', 401, 'AGENT_NOT_FOUND');
  }
  if (agent.is_active === false) {
    throw new AppError('This delivery agent is not active.', 403, 'AGENT_INACTIVE');
  }
  return agent;
}

/** Pending offers for an agent: SHIPPED orders not yet accepted. */
async function listOffers(rawCode) {
  await ensureSchema();
  const agent = await findAgent(rawCode);

  const { rows } = await pool.query(
    `SELECT o.id, o.total_amount, o.payment_method, o.shipping_address,
            o.delivery_code, o.created_at,
            u.full_name AS customer_name, u.phone AS customer_phone,
            shop.shop_name, shop.address AS shop_address, shop.phone AS shop_phone
     FROM orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN LATERAL (
       SELECT p.partner_id FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = o.id
       LIMIT 1
     ) sp ON true
     LEFT JOIN partner_profile shop ON shop.user_id = sp.partner_id
     WHERE o.delivery_agent_id = $1
       AND o.status = 'SHIPPED'
       AND o.delivery_accepted_at IS NULL
     ORDER BY o.handed_over_at DESC NULLS LAST, o.created_at DESC`,
    [agent.id],
  );

  const orderIds = rows.map((r) => r.id);
  const itemsByOrder = {};
  if (orderIds.length > 0) {
    const { rows: itemRows } = await pool.query(
      `SELECT oi.order_id, p.name_en AS name, oi.quantity
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ANY($1::uuid[])
       ORDER BY oi.created_at`,
      [orderIds],
    );
    for (const r of itemRows) {
      (itemsByOrder[r.order_id] ||= []).push({
        name: r.name || 'Product',
        quantity: Number(r.quantity) || 0,
      });
    }
  }

  return {
    agent: {
      code: agent.agent_code,
      name: agent.full_name,
      phone: agent.phone || null,
    },
    offers: rows.map((r) => ({
      id: r.id,
      orderNumber: String(r.id).slice(0, 8).toUpperCase(),
      totalAmount: Number(r.total_amount) || 0,
      paymentMethod: r.payment_method || '',
      shippingAddress: r.shipping_address || '',
      deliveryCode: r.delivery_code || null,
      customerName: r.customer_name || 'Customer',
      customerPhone: r.customer_phone || null,
      shopName: r.shop_name || 'Ema Store',
      shopAddress: r.shop_address || '',
      shopPhone: r.shop_phone || null,
      items: itemsByOrder[r.id] || [],
      createdAt: r.created_at,
    })),
  };
}

/** The order must be a pending offer addressed to THIS agent. */
async function lockOffer(client, agent, orderId) {
  const { rows } = await client.query(
    `SELECT id, status, delivery_agent_id, delivery_accepted_at
     FROM orders WHERE id = $1 FOR UPDATE`,
    [orderId],
  );
  const order = rows[0];
  if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  if (order.delivery_agent_id !== agent.id ||
      String(order.status).toUpperCase() !== 'SHIPPED' ||
      order.delivery_accepted_at) {
    throw new AppError('This order is not a pending offer for you.', 409, 'NOT_AN_OFFER');
  }
  return order;
}

async function acceptOffer(rawCode, orderId) {
  await ensureSchema();
  const agent = await findAgent(rawCode);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockOffer(client, agent, orderId);
    await client.query(
      `UPDATE orders SET delivery_accepted_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [orderId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { accepted: true, orderId };
}

async function declineOffer(rawCode, orderId) {
  await ensureSchema();
  const agent = await findAgent(rawCode);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockOffer(client, agent, orderId);
    // Back to PACKED so the partner can hand it to another delivery person.
    await client.query(
      `UPDATE orders
       SET status = 'PACKED', delivery_agent_id = NULL,
           handed_over_at = NULL, handover_code = NULL,
           delivery_accepted_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [orderId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { declined: true, orderId };
}

/**
 * Rider's own QR: returns the short agent id (shown under the QR) and an
 * AES-256-GCM encrypted, 5-minute token (the QR itself).
 */
async function getAgentQr(rawCode) {
  const agent = await findAgent(rawCode);
  const { token, expiresInSeconds, expiresAt } = encryptAgentCode(agent.agent_code);
  return {
    agentCode: agent.agent_code,
    token,
    expiresInSeconds,
    expiresAt,
    agent: { code: agent.agent_code, name: agent.full_name },
  };
}

module.exports = {
  getAgentQr, listOffers, acceptOffer, declineOffer };
