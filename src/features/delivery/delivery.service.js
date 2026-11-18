const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');
const { encryptAgentCode, createAgentDisplayCode } = require('./agent_qr');
const {
  ensureOrderFlowSchema,
  decryptDynamicToken,
  safeSendNotification,
  maskPhone,
} = require('../orders/order_flow');

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

/**
 * Step 3: Rider app shows pool of orders nobody has taken yet:
 * pickup place (shop name + address), delivery place (customer address), items, total.
 * Customer name/phone and shop phone are HIDDEN until accept.
 */
async function listOffers(rawCode) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);

  const { rows } = await pool.query(
    `SELECT o.id, o.total_amount, o.total_cents, o.payment_method, o.shipping_address,
            o.delivery_code, o.status, o.created_at,
            shop.shop_name, shop.address AS shop_address
     FROM orders o
     LEFT JOIN LATERAL (
       SELECT p.partner_id FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = o.id
       LIMIT 1
     ) sp ON true
     LEFT JOIN partner_profile shop ON shop.user_id = sp.partner_id
     WHERE o.delivery_agent_id IS NULL
       AND o.status IN ('CONFIRMED', 'PACKED')
     ORDER BY o.created_at DESC
     LIMIT 50`,
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
      orderNumber: String(r.delivery_code || r.id).slice(0, 8).toUpperCase(),
      totalAmount: Number(r.total_amount) || (r.total_cents ? r.total_cents / 100 : 0),
      paymentMethod: r.payment_method || '',
      shippingAddress: r.shipping_address || '',
      deliveryCode: r.delivery_code || null,
      status: r.status,
      // Step 3 Privacy: customer name/phone and shop phone hidden until accept
      customerName: null,
      customerPhone: null,
      shopPhone: null,
      shopName: r.shop_name || 'Ema Store Partner',
      shopAddress: r.shop_address || 'Addis Ababa, Ethiopia',
      items: itemsByOrder[r.id] || [],
      createdAt: r.created_at,
    })),
  };
}

/**
 * Step 3 & 4: Rider accepts an offer.
 * Concurrency row-locking: first rider wins; second gets 409 ORDER_TAKEN.
 * A rider can hold only ONE active order at a time.
 */
async function acceptOffer(rawCode, orderId) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);
  const client = await pool.connect();
  let updatedOrder;

  try {
    await client.query('BEGIN');

    // 1. Check if this rider already holds an active order
    const { rows: activeRows } = await client.query(
      `SELECT id FROM orders
       WHERE delivery_agent_id = $1
         AND status IN ('CONFIRMED', 'PACKED', 'SHIPPED')
         AND delivered_at IS NULL
       LIMIT 1`,
      [agent.id],
    );
    if (activeRows.length > 0) {
      throw new AppError(
        'You already have an active delivery in progress. Complete it before accepting another.',
        400,
        'RIDER_HAS_ACTIVE_ORDER',
      );
    }

    // 2. Lock target order for update
    const { rows } = await client.query(
      `SELECT id, status, delivery_agent_id, user_id, delivery_code
       FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = rows[0];
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    // 3. Concurrency check: already taken?
    if (order.delivery_agent_id && order.delivery_agent_id !== agent.id) {
      throw new AppError(
        'This order has already been taken by another rider.',
        409,
        'ORDER_TAKEN',
      );
    }

    // 4. Update order with this rider
    const { rows: updatedRows } = await client.query(
      `UPDATE orders
       SET delivery_agent_id = $1,
           delivery_accepted_at = NOW(),
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [agent.id, orderId],
    );
    updatedOrder = updatedRows[0];
    await client.query('COMMIT');

    // Step 4: Dispatch push notifications to partner and customer
    // Find partner(s)
    const { rows: partnerRows } = await pool.query(
      `SELECT DISTINCT p.partner_id FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [orderId],
    );
    for (const pr of partnerRows) {
      safeSendNotification(
        pr.partner_id,
        'Delivery Rider Assigned',
        `Rider ${agent.full_name} (${agent.agent_code}) accepted order #${order.delivery_code || orderId.slice(0, 8)}.`,
        { orderId, type: 'RIDER_ASSIGNED', riderName: agent.full_name },
      );
    }

    // Notify customer
    safeSendNotification(
      order.user_id,
      'Rider Assigned to Your Order',
      `Rider ${agent.full_name} is on the way to pick up your order #${order.delivery_code || orderId.slice(0, 8)}.`,
      { orderId, type: 'RIDER_ASSIGNED', riderName: agent.full_name },
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { accepted: true, orderId, order: updatedOrder };
}

/**
 * Rider declines or releases an uncompleted offer.
 */
async function declineOffer(rawCode, orderId) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, status, delivery_agent_id, delivered_at, delivery_requested_at FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = rows[0];
    const stillInDelivery = order && order.delivery_agent_id === agent.id
      && !order.delivered_at && order.delivery_requested_at == null;
    if (stillInDelivery) {
      await client.query(
        `UPDATE orders
         SET delivery_agent_id = NULL,
             delivery_accepted_at = NULL,
             handover_requested_at = NULL,
             handover_proof = NULL,
             handed_over_at = NULL,
             handover_code = NULL,
             rider_arrived_at = NULL,
             status = CASE WHEN status = 'SHIPPED' THEN 'PACKED' ELSE status END,
             updated_at = NOW()
         WHERE id = $1`,
        [orderId],
      );
    }
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
 * Step 4: After accept, rider gets full UNREDACTED details
 * (partner info + customer info).
 */
async function getActiveDelivery(rawCode) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);

  const { rows } = await pool.query(
    `SELECT o.id, o.total_amount, o.total_cents, o.payment_method, o.shipping_address,
            o.delivery_code, o.status, o.created_at, o.delivery_accepted_at,
            o.handover_requested_at, o.handover_proof, o.handed_over_at,
            o.delivery_requested_at, o.rider_arrived_at, o.delivery_proof, o.delivered_at,
            o.customer_accepted_at, o.customer_rejected_at, o.payment_status,
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
       AND o.status IN ('CONFIRMED', 'PACKED', 'SHIPPED')
       AND o.delivered_at IS NULL
     ORDER BY o.delivery_accepted_at DESC NULLS LAST
     LIMIT 1`,
    [agent.id],
  );

  if (rows.length === 0) return null;
  const r = rows[0];

  const { rows: itemRows } = await pool.query(
    `SELECT oi.order_id, p.name_en AS name, oi.quantity, oi.price_at_order
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1
     ORDER BY oi.created_at`,
    [r.id],
  );

  return {
    id: r.id,
    orderNumber: String(r.delivery_code || r.id).slice(0, 8).toUpperCase(),
    totalAmount: Number(r.total_amount) || (r.total_cents ? r.total_cents / 100 : 0),
    paymentMethod: r.payment_method || '',
    shippingAddress: r.shipping_address || '',
    deliveryCode: r.delivery_code || null,
    status: r.status,
    createdAt: r.created_at,
    deliveryAcceptedAt: r.delivery_accepted_at,
    handoverRequestedAt: r.handover_requested_at,
    handoverProof: r.handover_proof,
    handedOverAt: r.handed_over_at,
    deliveryRequestedAt: r.delivery_requested_at,
    riderArrivedAt: r.rider_arrived_at,
    deliveryProof: r.delivery_proof,
    deliveredAt: r.delivered_at,
    // Step 4: Unredacted details visible to assigned rider
    customerName: r.customer_name || 'Customer',
    customerPhone: r.customer_phone || null,
    shopName: r.shop_name || 'Ema Store Partner',
    shopAddress: r.shop_address || 'Addis Ababa, Ethiopia',
    shopPhone: r.shop_phone || null,
    items: itemRows.map((i) => ({
      name: i.name || 'Product',
      quantity: Number(i.quantity) || 1,
      price: Number(i.price_at_order) || 0,
    })),
  };
}

/**
 * Step 5d: Handover at the shop.
 * Rider taps POP-UP button "I took it from the partner".
 * Status becomes SHIPPED (product responsibility moves to rider).
 */
async function confirmPickup(rawCode, orderId) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);
  const client = await pool.connect();
  let updatedOrder;

  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, status, delivery_agent_id, handover_requested_at, user_id, delivery_code
       FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = rows[0];
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

    if (order.delivery_agent_id !== agent.id) {
      throw new AppError('You are not assigned to this order.', 403, 'NOT_ASSIGNED_RIDER');
    }

    if (!order.handover_requested_at) {
      throw new AppError('Partner has not handed over the package yet.', 400, 'HANDOVER_NOT_REQUESTED');
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE orders
       SET status = 'SHIPPED',
           handed_over_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [orderId],
    );
    updatedOrder = updatedRows[0];
    await client.query('COMMIT');

    // Notify customer
    safeSendNotification(
      order.user_id,
      'Order On The Way',
      `Your order #${order.delivery_code || orderId.slice(0, 8)} has been picked up from the shop and is on its way.`,
      { orderId, type: 'ORDER_SHIPPED' },
    );

    // Notify partner
    const { rows: partnerRows } = await pool.query(
      `SELECT DISTINCT p.partner_id FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [orderId],
    );
    for (const pr of partnerRows) {
      safeSendNotification(
        pr.partner_id,
        'Handover Completed',
        `Rider ${agent.full_name} has taken order #${order.delivery_code || orderId.slice(0, 8)}.`,
        { orderId, type: 'HANDOVER_COMPLETED' },
      );
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { pickedUp: true, orderId, order: updatedOrder };
}

/**
 * Step 6a & 6b: Delivery at the customer.
 * Rider scans customer's QR. Backend decrypts QR and checks it belongs to
 * THIS order's customer (else WRONG_CUSTOMER).
 * Rider submits photo/video proof.
 * Sets delivery_requested_at and stores proof. Customer app shows pop-up.
 */
async function scanDelivery(rawCode, orderId, { customerQrToken, proof = [] }) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);

  if (!customerQrToken) {
    throw new AppError('Customer QR token is required.', 400, 'QR_TOKEN_REQUIRED');
  }

  // Decrypt and verify dynamic customer token. If the rider typed the
  // customer's 5-minute display ID instead of scanning the QR, resolve
  // it through user_qr_display_codes.
  let scannedUserId = null;
  try {
    const decrypted = decryptDynamicToken(customerQrToken);
    scannedUserId = decrypted.userId || decrypted.sub || decrypted.id || null;
  } catch (_) {
    const { rows: dc } = await pool.query(
      `SELECT user_id FROM user_qr_display_codes
       WHERE UPPER(code) = UPPER($1) AND expires_at > NOW()`,
      [String(customerQrToken).trim()],
    );
    scannedUserId = dc[0] ? dc[0].user_id : null;
  }
  if (!scannedUserId) {
    throw new AppError('Could not identify customer from QR token.', 400, 'INVALID_CUSTOMER_QR');
  }

  const client = await pool.connect();
  let updatedOrder;

  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, status, delivery_agent_id, user_id, delivery_code
       FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = rows[0];
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

    if (order.delivery_agent_id !== agent.id) {
      throw new AppError('You are not assigned to this order.', 403, 'NOT_ASSIGNED_RIDER');
    }

    if (String(order.status).toUpperCase() !== 'SHIPPED') {
      throw new AppError('Pick up the package from the partner before scanning the customer QR.', 400, 'PICKUP_NOT_CONFIRMED');
    }

    if (String(order.user_id) !== String(scannedUserId)) {
      throw new AppError('Scanned QR code does not match the customer for this order.', 400, 'WRONG_CUSTOMER');
    }

    const proofJson = JSON.stringify(Array.isArray(proof) ? proof : []);

    const { rows: updatedRows } = await client.query(
      `UPDATE orders
       SET delivery_requested_at = NOW(),
           delivery_proof = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [proofJson, orderId],
    );
    updatedOrder = updatedRows[0];
    await client.query('COMMIT');

    // Notify customer to tap "I accepted the product"
    safeSendNotification(
      order.user_id,
      'Delivery Arrived!',
      `Rider has arrived with order #${order.delivery_code || orderId.slice(0, 8)}. Please confirm receipt in the app.`,
      { orderId, type: 'DELIVERY_REQUESTED' },
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { verified: true, orderId, order: updatedOrder };
}

/**
 * Past deliveries for this agent: orders they collected that are finished
 * (delivered, or cancelled after hand-over). Powers the rider app's
 * "My Orders" history tab.
 */
async function getDeliveryHistory(rawCode, { limit = 50 } = {}) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);
  const max = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  const { rows } = await pool.query(
    `SELECT o.id, o.total_amount, o.total_cents, o.payment_method, o.shipping_address,
            o.delivery_code, o.status, o.created_at, o.updated_at,
            o.delivery_accepted_at, o.handed_over_at, o.delivered_at,
            o.delivery_requested_at, o.customer_accepted_at,
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
       AND (o.delivered_at IS NOT NULL OR o.status IN ('DELIVERED', 'CANCELLED'))
     ORDER BY COALESCE(o.delivered_at, o.updated_at, o.created_at) DESC
     LIMIT $2`,
    [agent.id, max],
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
    agent: { code: agent.agent_code, name: agent.full_name },
    history: rows.map((r) => ({
      id: r.id,
      orderNumber: r.delivery_code || String(r.id).slice(0, 8).toUpperCase(),
      totalAmount: Number(r.total_amount) || (r.total_cents ? r.total_cents / 100 : 0),
      paymentMethod: r.payment_method || '',
      shippingAddress: r.shipping_address || '',
      deliveryCode: r.delivery_code || null,
      status: r.status,
      createdAt: r.created_at,
      deliveryAcceptedAt: r.delivery_accepted_at,
      handedOverAt: r.handed_over_at,
      deliveredAt: r.delivered_at,
      deliveryRequestedAt: r.delivery_requested_at,
      customerAcceptedAt: r.customer_accepted_at,
      customerRejectedAt: r.customer_rejected_at,
      customerName: r.customer_name || 'Customer',
      customerPhone: r.customer_phone || null,
      shopName: r.shop_name || 'Ema Store Partner',
      shopAddress: r.shop_address || '',
      shopPhone: r.shop_phone || null,
      items: itemsByOrder[r.id] || [],
    })),
  };
}

/**
 * Rider taps 'I have arrived' at the customer address.
 * Backend verifies the delivery is SHIPPED, then sets rider_arrived_at.
 */
async function markArrived(rawCode, orderId) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, status, delivery_agent_id, delivered_at, rider_arrived_at FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = rows[0];
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    if (order.delivery_agent_id !== agent.id) {
      throw new AppError('You are not assigned to this order.', 403, 'NOT_ASSIGNED_RIDER');
    }
    if (String(order.status).toUpperCase() !== 'SHIPPED' || order.delivered_at) {
      throw new AppError('This delivery is not on the way yet.', 400, 'NOT_ON_THE_WAY');
    }
    if (order.rider_arrived_at) {
      await client.query('COMMIT');
      return { arrived: true, orderId, alreadyArrived: true };
    }
    await client.query(
      `UPDATE orders SET rider_arrived_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [orderId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { arrived: true, orderId };
}

/**
 * Rider's own dynamic QR: 5-minute encrypted AES-256-GCM token.
 */
async function getAgentQr(rawCode) {
  const agent = await findAgent(rawCode);
  const { token, expiresInSeconds, expiresAt } = encryptAgentCode(agent.agent_code);
  let displayCode = null;
  try {
    displayCode = await createAgentDisplayCode(agent.id);
  } catch (_) {
    // Display ID is cosmetic — never block QR generation because of it.
  }
  return {
    agentCode: agent.agent_code,
    displayCode,
    token,
    expiresInSeconds,
    expiresAt,
    agent: { code: agent.agent_code, name: agent.full_name },
  };
}

module.exports = {
  getAgentQr,
  listOffers,
  acceptOffer,
  declineOffer,
  getActiveDelivery,
  confirmPickup,
  scanDelivery,
  markArrived,
  getDeliveryHistory,
};
