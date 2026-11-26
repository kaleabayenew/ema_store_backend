const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');
const { encryptAgentCode, createAgentDisplayCode } = require('./agent_qr');
const { getOfferAcceptanceBlock } = require('./offer_rules');
const {
  ensureOrderFlowSchema,
  decryptDynamicToken,
  safeSendNotification,
  maskPhone,
  parseAddressPin,
  cleanCoord,
} = require('../orders/order_flow');

/** Accepts raw QR content such as "ABC123" or "EMA-AGENT:ABC123". */
function normalizeAgentCode(raw) {
  let code = String(raw || '').trim();
  if (code.includes(':')) code = code.split(':').pop().trim();
  return code.toUpperCase().slice(0, 40);
}

/**
 * Orders created before the fee engine have delivery_fee_cents = 0. For
 * in-flight orders, recompute + persist the real fee so the rider sees the
 * same amount the customer was charged. Delivered/cancelled orders are
 * skipped inside ensureOrderFeeCents (payouts already settled).
 */
async function applyFeeBackfill(job) {
  if (!job || !job.id || Number(job.deliveryFeeCents) > 0) return;
  try {
    const feeSvc = require('./delivery_fee.service');
    const res = await feeSvc.ensureOrderFeeCents(job.id);
    if (res.feeCents > 0) {
      job.deliveryFeeCents = res.feeCents;
      job.riderEarningCents = Math.max(
        0,
        res.feeCents - res.riderCommissionCents,
      );
    }
  } catch (_) {
    // Best-effort — never break the delivery flow over a fee lookup.
  }
}

let issueSchemaPromise = null;
/** Columns for rider-reported delivery problems (overdue handling). */
function ensureDeliveryIssueSchema(db = pool) {
  if (!issueSchemaPromise) {
    issueSchemaPromise = (async () => {
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_issue_reason TEXT`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_issue_reported_at TIMESTAMP WITH TIME ZONE`);
      await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_issue_resolved BOOLEAN NOT NULL DEFAULT FALSE`);
    })().catch((e) => { issueSchemaPromise = null; throw e; });
  }
  return issueSchemaPromise;
}

async function findAgent(code) {
  const normalized = normalizeAgentCode(code);
  if (!normalized) {
    throw new AppError('Delivery agent code is required.', 401, 'AGENT_CODE_REQUIRED');
  }
  let { rows } = await pool.query(
    `SELECT id, agent_code, full_name, phone, is_active
     FROM delivery_agents WHERE agent_code = $1`,
    [normalized],
  );
  if (!rows[0] && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
    const byId = await pool.query(
      `SELECT id, agent_code, full_name, phone, is_active
       FROM delivery_agents WHERE id = $1`,
      [normalized],
    );
    if (byId.rows[0]) rows = byId.rows;
  }
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
/**
 * Rider app reports its GPS position (call every ~10 s while on shift).
 * Customers see it on the live-tracking map of their order.
 */
async function updateAgentLocation(rawCode, lat, lng) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);
  const la = cleanCoord(lat, 90);
  const ln = cleanCoord(lng, 180);
  if (la === null || ln === null) {
    throw new AppError('Valid lat and lng are required.', 400, 'INVALID_LOCATION');
  }
  await pool.query(
    `UPDATE delivery_agents
        SET last_lat = $1, last_lng = $2, last_location_at = NOW()
      WHERE id = $3`,
    [la, ln, agent.id],
  );
  return { ok: true, updatedAt: new Date().toISOString() };
}

/**
 * Keep overdue deliveries assigned, but notify admins only once per order.
 */
async function notifyOverdueDeliveries() {
  const { rows: admins } = await pool.query(
    `SELECT id FROM users WHERE UPPER(role) IN ('ADMIN', 'SUPER_ADMIN')`,
  );
  if (admins.length === 0) return;

  const { rows: overdueRows } = await pool.query(
    `INSERT INTO delivery_overdue_alerts (order_id)
     SELECT id
     FROM orders
     WHERE delivery_agent_id IS NOT NULL
       AND delivered_at IS NULL
       AND UPPER(COALESCE(status, '')) NOT IN (
         'CANCELLED', 'CANCELED', 'DELIVERED', 'COMPLETED', 'RETURNED', 'REFUNDED', 'FAILED'
       )
       AND delivery_accepted_at < NOW() - INTERVAL '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM delivery_overdue_alerts doa WHERE doa.order_id = orders.id
       )
     ON CONFLICT (order_id) DO NOTHING
     RETURNING order_id`,
  );
  if (overdueRows.length === 0) return;

  for (const overdue of overdueRows) {
    for (const admin of admins) {
      safeSendNotification(
        admin.id,
        'Delivery overdue',
        `Order ${String(overdue.order_id).slice(0, 8).toUpperCase()} has been active for over 24 hours and needs review.`,
        { orderId: overdue.order_id, type: 'DELIVERY_OVERDUE' },
      );
    }
  }
}

async function notifyRidersOfNewOffer(orderId) {
  await ensureOrderFlowSchema();
  const { rows: orders } = await pool.query(
    `SELECT id, status, payment_status, payment_method, delivery_agent_id,
            delivery_code
     FROM orders
     WHERE id = $1 AND delivery_agent_id IS NULL`,
    [orderId],
  );
  const order = orders[0];
  if (!order || getOfferAcceptanceBlock(order)) return 0;

  const { rows: riders } = await pool.query(
    `SELECT id, fcm_token
     FROM delivery_agents
     WHERE is_active = TRUE
       AND fcm_token IS NOT NULL`,
  );
  if (riders.length === 0) return 0;

  const { sendPush } = require('../../core/config/firebase');
  const title = 'New delivery available';
  const body = `Order #${order.delivery_code || String(order.id).slice(0, 8)} is ready for delivery.`;
  const results = await Promise.all(
    riders.map(async (rider) => {
      const result = await sendPush(rider.fcm_token, { title, body }, {
        orderId: order.id,
        type: 'RIDER_NEW_ORDER',
        channelId: 'eco_offers',
        localNotification: 'true',
      });
      if (result === 'INVALID_TOKEN') {
        await pool.query(
          `UPDATE delivery_agents SET fcm_token = NULL
           WHERE id = $1 AND fcm_token = $2`,
          [rider.id, rider.fcm_token],
        );
      }
      return result === true;
    }),
  );
  return results.filter(Boolean).length;
}

async function processOverdueDeliveries() {
  await ensureOrderFlowSchema();
  await notifyOverdueDeliveries();
}

async function listOffers(rawCode) {
  await ensureOrderFlowSchema();
  await notifyOverdueDeliveries();
  let agent = null;
  if (rawCode) {
    try {
      agent = await findAgent(rawCode);
    } catch (_) {
      // Allow fallback if agent is not yet registered or code is demo/guest
    }
  }

  const { rows } = await pool.query(
    `SELECT o.id, o.total_amount, o.total_cents, o.payment_method, o.payment_status,
            o.shipping_address, o.delivery_code, o.status, o.created_at,
            o.delivery_fee_cents,
            o.rider_commission_cents,
            COALESCE(shop.shop_name, shop.business_name, 'Shop') AS shop_name,
            COALESCE(shop.address, shop.city, 'Addis Ababa') AS shop_address
     FROM orders o
     LEFT JOIN LATERAL (
       SELECT p.partner_id FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = o.id
       LIMIT 1
     ) sp ON true
     LEFT JOIN partner_profile shop ON shop.user_id = sp.partner_id
     WHERE o.delivery_agent_id IS NULL
       AND UPPER(TRIM(COALESCE(o.status, ''))) NOT IN (
         'CANCELLED', 'CANCELED', 'DELIVERED', 'COMPLETED', 'RETURNED', 'REFUNDED', 'FAILED'
       )
     ORDER BY o.created_at DESC`,
  );

  const orderIds = rows.map((r) => r.id);
  const itemsByOrder = {};
  if (orderIds.length > 0) {
    const { rows: itemRows } = await pool.query(
      `SELECT oi.order_id, p.name_en AS name, oi.quantity,
              p.partner_id,
              COALESCE(pp.shop_name, pp.business_name) AS shop_name,
              COALESCE(pp.address, pp.city) AS shop_address,
              pp.shop_lat, pp.shop_lng
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN partner_profile pp ON pp.user_id = p.partner_id
       WHERE oi.order_id = ANY($1::uuid[])
       ORDER BY oi.created_at`,
      [orderIds],
    );
    for (const r of itemRows) {
      (itemsByOrder[r.order_id] ||= []).push({
        name: r.name || 'Product',
        quantity: Number(r.quantity) || 0,
        partnerId: r.partner_id || null,
        shopName: r.shop_name || null,
        shopAddress: r.shop_address || null,
        shopLat: r.shop_lat ?? null,
        shopLng: r.shop_lng ?? null,
      });
    }
  }

  const result = {
    agent: agent
      ? {
          code: agent.agent_code,
          name: agent.full_name,
          phone: agent.phone || null,
        }
      : {
          code: 'RIDER-001',
          name: 'Delivery Rider',
          phone: null,
        },
    offers: rows.map((r) => {
      const acceptanceBlock = getOfferAcceptanceBlock(r);
      return {
        id: r.id,
        orderNumber: String(r.delivery_code || r.id).slice(0, 8).toUpperCase(),
        totalAmount: Number(r.total_amount) || (r.total_cents ? r.total_cents / 100 : 0),
        paymentMethod: r.payment_method || '',
        paymentStatus: r.payment_status || 'PENDING',
        shippingAddress: acceptanceBlock ? '' : r.shipping_address || '',
        dropoffLat: acceptanceBlock ? null : parseAddressPin(r.shipping_address).lat,
        dropoffLng: acceptanceBlock ? null : parseAddressPin(r.shipping_address).lng,
        deliveryCode: r.delivery_code || null,
        status: r.status,
        canAcceptOffer: acceptanceBlock === null,
        acceptanceBlockCode: acceptanceBlock?.code || null,
        acceptanceBlockReason: acceptanceBlock?.message || null,
        deliveryFeeCents: Number(r.delivery_fee_cents) || 0,
        // Net amount the rider actually earns (fee minus platform commission).
        riderEarningCents: (() => {
          const fee = Number(r.delivery_fee_cents) || 0;
          if (fee <= 0) return null;
          return Math.max(0, fee - (Number(r.rider_commission_cents) || 0));
        })(),
        // Step 3 Privacy: customer name/phone and shop phone hidden until accept
        customerName: null,
        customerPhone: null,
        shopPhone: null,
        shopName: r.shop_name || 'Ema Store Partner',
        shopAddress: r.shop_address || 'Addis Ababa, Ethiopia',
        items: itemsByOrder[r.id] || [],
        // Multi-shop orders: one leg per partner location so the rider app
        // can show each pickup point separately.
        legs: (() => {
          const byPartner = new Map();
          for (const it of itemsByOrder[r.id] || []) {
            const key = it.partnerId || it.shopName || 'unknown';
            if (!byPartner.has(key)) {
              byPartner.set(key, {
                shopName: it.shopName || 'Ema Store Partner',
                shopAddress: it.shopAddress || 'Addis Ababa, Ethiopia',
                shopLat: it.shopLat ?? null,
                shopLng: it.shopLng ?? null,
                items: [],
              });
            }
            byPartner.get(key).items.push(`${it.name} x${it.quantity}`);
          }
          return [...byPartner.values()].map((l) => ({
            shopName: l.shopName,
            shopAddress: l.shopAddress,
            shopLat: l.shopLat,
            shopLng: l.shopLng,
            items: l.items,
          }));
        })(),
        createdAt: r.created_at,
      };
    }),
  };

  for (const offer of result.offers) {
    await applyFeeBackfill(offer);
  }
  return result;
}

/**
 * Step 3 & 4: Rider accepts an offer.
 * Concurrency row-locking: first rider wins; second gets 409 ORDER_TAKEN.
 * The rider may hold multiple active orders; each order remains independently locked.
 */
async function acceptOffer(rawCode, orderId) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);
  const client = await pool.connect();
  let updatedOrder;

  try {
    await client.query('BEGIN');

    // Serialize accepts per rider so concurrent requests cannot assign
    // multiple orders to the same agent.
    const { rows: agentRows } = await client.query(
      `SELECT id, is_active FROM delivery_agents WHERE id = $1 FOR UPDATE`,
      [agent.id],
    );
    if (!agentRows[0] || agentRows[0].is_active === false) {
      throw new AppError(
        'This delivery agent is not active.',
        403,
        'AGENT_INACTIVE',
      );
    }

    // Lock the target order before assigning it; the agent-row lock allows
    // this rider to accept multiple orders without racing the assignment.
    const { rows } = await client.query(
      `SELECT id, status, payment_status, payment_method,
              delivery_agent_id, user_id, delivery_code
       FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = rows[0];
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    if (order.delivery_agent_id === agent.id) {
      await client.query('COMMIT');
      return { accepted: true, orderId, order, alreadyAssigned: true };
    }

    const acceptanceBlock = getOfferAcceptanceBlock(order);
    if (acceptanceBlock) {
      throw new AppError(
        acceptanceBlock.message,
        409,
        acceptanceBlock.code,
      );
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
async function getActiveJobs(rawCode, orderId = null) {
  await ensureOrderFlowSchema();
  await ensureDeliveryIssueSchema();
  if (!orderId) await notifyOverdueDeliveries();
  // Unknown/inactive agent codes must not 401 here — the rider app polls
  // this endpoint before listing offers, and a failure would hide the whole
  // Available tab. No recognised agent simply means no active delivery.
  let agent;
  try {
    agent = await findAgent(rawCode);
  } catch (_) {
    return [];
  }

  const { rows } = await pool.query(
    `SELECT o.id, o.total_amount, o.total_cents, o.payment_method, o.shipping_address,
            o.delivery_code, o.status, o.created_at, o.delivery_accepted_at,
            o.delivery_accepted_at + INTERVAL '24 hours' AS delivery_deadline_at,
            (o.delivery_accepted_at < NOW() - INTERVAL '24 hours') AS is_overdue,
            o.handover_requested_at, o.handover_proof, o.handed_over_at,
            o.delivery_requested_at, o.rider_arrived_at, o.delivery_proof, o.delivered_at,
            o.customer_accepted_at, o.customer_rejected_at, o.payment_status,
            o.delivery_fee_cents, o.rider_commission_cents,
            o.delivery_issue_reason, o.delivery_issue_reported_at,
            u.full_name AS customer_name, u.phone AS customer_phone,
            COALESCE(shop.shop_name, shop.business_name, 'Shop') AS shop_name,
            COALESCE(shop.address, shop.city, 'Addis Ababa') AS shop_address, shop.phone AS shop_phone
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
       AND o.status IN ('CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED')
       AND o.delivered_at IS NULL
       AND ($2::text IS NULL OR o.id::text = $2)
     ORDER BY o.delivery_accepted_at DESC NULLS LAST
     `,
    [agent.id, orderId],
  );

  const activeRows = rows;
  if (activeRows.length === 0) return [];

  const activeIds = activeRows.map((row) => row.id);
  const { rows: itemRows } = await pool.query(
    `SELECT oi.order_id, p.name_en AS name, oi.quantity, oi.price_at_order,
            p.partner_id,
            COALESCE(pp.shop_name, pp.business_name) AS shop_name,
            COALESCE(pp.address, pp.city) AS shop_address,
            pp.shop_lat, pp.shop_lng
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN partner_profile pp ON pp.user_id = p.partner_id
     WHERE oi.order_id = ANY($1::uuid[])
     ORDER BY oi.created_at`,
    [activeIds],
  );

  const itemsByOrder = new Map();
  for (const item of itemRows) {
    const items = itemsByOrder.get(item.order_id) || [];
    items.push(item);
    itemsByOrder.set(item.order_id, items);
  }

  const jobs = [];
  for (const r of activeRows) {
    const orderItems = itemsByOrder.get(r.id) || [];
    const job = {
      id: r.id,
      orderNumber: String(r.delivery_code || r.id).slice(0, 8).toUpperCase(),
      totalAmount: Number(r.total_amount) || (r.total_cents ? r.total_cents / 100 : 0),
      paymentMethod: r.payment_method || '',
      paymentStatus: r.payment_status || 'PENDING',
      shippingAddress: r.shipping_address || '',
      dropoffLat: parseAddressPin(r.shipping_address).lat,
      dropoffLng: parseAddressPin(r.shipping_address).lng,
      deliveryCode: r.delivery_code || null,
      status: r.status,
      createdAt: r.created_at,
      deliveryAcceptedAt: r.delivery_accepted_at,
      deliveryDeadlineAt: r.delivery_deadline_at,
      isOverdue: r.is_overdue === true,
      issueReason: r.delivery_issue_reason || null,
      issueReportedAt: r.delivery_issue_reported_at || null,
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
      items: orderItems.map((i) => ({
        name: i.name || 'Product',
        quantity: Number(i.quantity) || 1,
        price: Number(i.price_at_order) || 0,
        partnerId: i.partner_id || null,
        shopName: i.shop_name || null,
        shopAddress: i.shop_address || null,
        shopLat: i.shop_lat ?? null,
        shopLng: i.shop_lng ?? null,
      })),
      deliveryFeeCents: Number(r.delivery_fee_cents) || 0,
      riderEarningCents: (() => {
        const fee = Number(r.delivery_fee_cents) || 0;
        if (fee <= 0) return null;
        return Math.max(0, fee - (Number(r.rider_commission_cents) || 0));
      })(),
      legs: (() => {
        const byPartner = new Map();
        for (const it of orderItems) {
          const key = it.partner_id || it.shop_name || 'unknown';
          if (!byPartner.has(key)) {
            byPartner.set(key, {
              shopName: it.shop_name || 'Ema Store Partner',
              shopAddress: it.shop_address || 'Addis Ababa, Ethiopia',
              shopLat: it.shop_lat ?? null,
              shopLng: it.shop_lng ?? null,
              items: [],
            });
          }
          byPartner.get(key).items.push(`${it.name || 'Product'} x${Number(it.quantity) || 1}`);
        }
        return [...byPartner.values()].map((l) => ({
          shopName: l.shopName,
          shopAddress: l.shopAddress,
          shopLat: l.shopLat,
          shopLng: l.shopLng,
          items: l.items,
        }));
      })(),
    };
    await applyFeeBackfill(job);
    jobs.push(job);
  }

  return jobs;
}

async function getActiveDeliveries(rawCode) {
  return getActiveJobs(rawCode);
}

async function getActiveDelivery(rawCode, orderId = null) {
  const jobs = await getActiveJobs(rawCode, orderId);
  return jobs[0] || null;
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

    // Escrow: deposit 50% of each partner's share to their wallet.
    const escrow = require('./escrow.service');
    await escrow.settlePickupPayouts(client, order);

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
async function getDeliveryHistory(
  rawCode,
  { limit = 50, page = 1, from = null, to = null, status = null } = {},
) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);
  const max = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const offset = (safePage - 1) * max;

  // Optional filters: delivered_at range (falls back to created_at for
  // orders delivered before the timestamp column existed) + status.
  const conditions = [
    `o.delivery_agent_id = $1`,
    `(o.delivered_at IS NOT NULL OR o.status IN ('DELIVERED', 'CANCELLED'))`,
  ];
  const params = [agent.id];
  if (from) {
    params.push(from);
    conditions.push(`COALESCE(o.delivered_at, o.updated_at, o.created_at) >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`COALESCE(o.delivered_at, o.updated_at, o.created_at) <= $${params.length}`);
  }
  const statusFilter = `${status || ''}`.toUpperCase();
  if (['DELIVERED', 'CANCELLED'].includes(statusFilter)) {
    params.push(statusFilter);
    conditions.push(`o.status = $${params.length}`);
  }
  const where = conditions.join(' AND ');

  const [countRes, rowsRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS c FROM orders o WHERE ${where}`,
      params,
    ),
    pool.query(
    `SELECT o.id, o.total_amount, o.total_cents, o.payment_method, o.shipping_address,
            o.delivery_code, o.status, o.created_at, o.updated_at,
            o.delivery_fee_cents, o.rider_commission_cents,
            o.delivery_accepted_at, o.handed_over_at, o.delivered_at,
            o.delivery_requested_at, o.customer_accepted_at,
            u.full_name AS customer_name, u.phone AS customer_phone,
            COALESCE(shop.shop_name, shop.business_name, 'Shop') AS shop_name,
            COALESCE(shop.address, shop.city, 'Addis Ababa') AS shop_address, shop.phone AS shop_phone
     FROM orders o
     JOIN users u ON u.id = o.user_id
     LEFT JOIN LATERAL (
       SELECT p.partner_id FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = o.id
       LIMIT 1
     ) sp ON true
     LEFT JOIN partner_profile shop ON shop.user_id = sp.partner_id
     WHERE ${where}
     ORDER BY COALESCE(o.delivered_at, o.updated_at, o.created_at) DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, max, offset],
    ),
  ]);
  const rows = rowsRes.rows;
  const total = Number(countRes.rows[0]?.c || 0);

  const orderIds = rows.map((r) => r.id);
  const itemsByOrder = {};
  if (orderIds.length > 0) {
    const { rows: itemRows } = await pool.query(
      `SELECT oi.order_id, p.name_en AS name, oi.quantity,
              p.partner_id,
              COALESCE(pp.shop_name, pp.business_name) AS shop_name,
              COALESCE(pp.address, pp.city) AS shop_address,
              pp.shop_lat, pp.shop_lng
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN partner_profile pp ON pp.user_id = p.partner_id
       WHERE oi.order_id = ANY($1::uuid[])
       ORDER BY oi.created_at`,
      [orderIds],
    );
    for (const r of itemRows) {
      (itemsByOrder[r.order_id] ||= []).push({
        name: r.name || 'Product',
        quantity: Number(r.quantity) || 0,
        partnerId: r.partner_id || null,
        shopName: r.shop_name || null,
        shopAddress: r.shop_address || null,
        shopLat: r.shop_lat ?? null,
        shopLng: r.shop_lng ?? null,
      });
    }
  }

  return {
    agent: { code: agent.agent_code, name: agent.full_name },
    total,
    page: safePage,
    pages: Math.max(1, Math.ceil(total / max)),
    history: rows.map((r) => ({
      id: r.id,
      orderNumber: r.delivery_code || String(r.id).slice(0, 8).toUpperCase(),
      totalAmount: Number(r.total_amount) || (r.total_cents ? r.total_cents / 100 : 0),
      paymentMethod: r.payment_method || '',
      shippingAddress: r.shipping_address || '',
      dropoffLat: parseAddressPin(r.shipping_address).lat,
      dropoffLng: parseAddressPin(r.shipping_address).lng,
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
      deliveryFeeCents: Number(r.delivery_fee_cents) || 0,
      riderEarningCents: (() => {
        const fee = Number(r.delivery_fee_cents) || 0;
        if (fee <= 0) return null;
        return Math.max(0, fee - (Number(r.rider_commission_cents) || 0));
      })(),
      legs: (() => {
        const byPartner = new Map();
        for (const it of itemsByOrder[r.id] || []) {
          const key = it.partnerId || it.shopName || 'unknown';
          if (!byPartner.has(key)) {
            byPartner.set(key, {
              shopName: it.shopName || 'Ema Store Partner',
              shopAddress: it.shopAddress || 'Addis Ababa, Ethiopia',
              shopLat: it.shopLat ?? null,
              shopLng: it.shopLng ?? null,
              items: [],
            });
          }
          byPartner.get(key).items.push(`${it.name} x${it.quantity}`);
        }
        return [...byPartner.values()].map((l) => ({
          shopName: l.shopName,
          shopAddress: l.shopAddress,
          shopLat: l.shopLat,
          shopLng: l.shopLng,
          items: l.items,
        }));
      })(),
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

/**
 * Rider earnings summary: totals for today / last 7 days / all time plus a
 * short list of recent completed deliveries. The per-delivery earning uses
 * the same 10% rule the ride app applies to the order total.
 */
/**
 * Wallet transaction history for the rider's linked user account.
 * The rider authenticates by agent code; payouts are written to
 * wallet_transactions under the user account matched by phone (same
 * join escrow payouts use). Returns paginated rows, newest first.
 */
async function getWalletTransactions(rawCode, { page = 1, limit = 20 } = {}) {
  await ensureOrderFlowSchema();
  let agent = null;
  try {
    agent = await findAgent(rawCode);
  } catch (_) {
    agent = null;
  }
  if (!agent) return { transactions: [], total: 0, page, pages: 0 };

  const userId = await agentUserId(agent);
  if (!userId) return { transactions: [], total: 0, page, pages: 0 };

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (safePage - 1) * safeLimit;

  const [rowsRes, countRes] = await Promise.all([
    pool.query(
      `SELECT id, title, description, amount, type, status, created_at
       FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, safeLimit, offset],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM wallet_transactions WHERE user_id = $1`,
      [userId],
    ),
  ]);

  const total = Number(countRes.rows[0]?.c || 0);
  return {
    transactions: rowsRes.rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description || '',
      amountCents: Math.round(Number(r.amount || 0) * 100),
      type: r.type,
      status: r.status,
      createdAt: r.created_at,
    })),
    total,
    page: safePage,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

/** Resolve the rider's user account via the phone join (same as payouts). */
async function agentUserId(agent) {
  const { rows } = await pool.query(
    `SELECT u.id FROM delivery_agents da
     JOIN users u ON u.phone = da.phone
     WHERE da.id = $1`,
    [agent.id],
  );
  return rows[0]?.id || null;
}

/**
 * Notification inbox for the rider's linked user account.
 * Returns newest-first rows; empty when the agent has no user account.
 */
async function getNotifications(rawCode, { limit = 30 } = {}) {
  await ensureOrderFlowSchema();
  let agent = null;
  try {
    agent = await findAgent(rawCode);
  } catch (_) {
    agent = null;
  }
  if (!agent) return { notifications: [], unread: 0 };

  const userId = await agentUserId(agent);
  if (!userId) return { notifications: [], unread: 0 };

  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
  const [rowsRes, unreadRes] = await Promise.all([
    pool.query(
      `SELECT id, title, body, data, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, safeLimit],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM notifications
       WHERE user_id = $1 AND is_read = false`,
      [userId],
    ),
  ]);

  return {
    notifications: rowsRes.rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body || '',
      data: r.data || {},
      isRead: !!r.is_read,
      createdAt: r.created_at,
    })),
    unread: Number(unreadRes.rows[0]?.c || 0),
  };
}

/** Mark every notification read for the rider's linked user account. */
async function markNotificationsRead(rawCode) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);
  const userId = await agentUserId(agent);
  if (!userId) return { marked: 0 };
  const { rowCount } = await pool.query(
    `UPDATE notifications SET is_read = true
     WHERE user_id = $1 AND is_read = false`,
    [userId],
  );
  return { marked: rowCount || 0 };
}

/**
 * Delivery heatmap: aggregates delivered orders by Addis Ababa zone
 * (keyword match on the shipping address, same lookup the fee engine uses).
 * Returns per-zone order counts, revenue and distinct partner shops, plus
 * the top partner shops overall — powers the rider heatmap screen.
 */
async function getDeliveryZones(rawCode, { days = 90 } = {}) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);
  const safeDays = Math.min(365, Math.max(1, parseInt(days, 10) || 90));

  const { zoneLookup } = require('./delivery_fee.service');

  const { rows } = await pool.query(
    `SELECT o.shipping_address,
            COALESCE(o.total_cents, ROUND(o.total_amount * 100)::int) AS total_cents,
            COALESCE(shop.shop_name, shop.business_name, 'Shop') AS shop_name
     FROM orders o
     LEFT JOIN LATERAL (
       SELECT p.partner_id FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = o.id
       LIMIT 1
     ) sp ON true
     LEFT JOIN partner_profile shop ON shop.user_id = sp.partner_id
     WHERE o.delivered_at IS NOT NULL
       AND o.delivered_at >= NOW() - ($1 || ' days')::interval`,
    [String(safeDays)],
  );

  const zones = new Map();
  const partners = new Map();
  const bump = (map, key, fn) => {
    if (!map.has(key)) map.set(key, fn());
    return map.get(key);
  };

  for (const r of rows) {
    const z = zoneLookup(r.shipping_address);
    const zoneName = z ? z.keys[0] : 'other';
    const revenue = Number(r.total_cents) || 0;
    const entry = bump(zones, zoneName, () => ({
      name: zoneName === 'other' ? 'Other areas' : zoneName,
      lat: z ? z.lat : null,
      lng: z ? z.lng : null,
      orders: 0,
      revenueCents: 0,
      partnerNames: new Set(),
    }));
    entry.orders += 1;
    entry.revenueCents += revenue;
    if (r.shop_name) entry.partnerNames.add(r.shop_name);

    if (r.shop_name) {
      const p = bump(partners, r.shop_name, () => ({
        shopName: r.shop_name,
        orders: 0,
        revenueCents: 0,
      }));
      p.orders += 1;
      p.revenueCents += revenue;
    }
  }

  const zoneList = [...zones.values()]
    .map((z) => ({
      name: z.name,
      lat: z.lat,
      lng: z.lng,
      orders: z.orders,
      revenueCents: z.revenueCents,
      partners: z.partnerNames.size,
    }))
    .sort((a, b) => b.orders - a.orders);

  const partnerList = [...partners.values()]
    .map((p) => ({
      shopName: p.shopName,
      orders: p.orders,
      revenueCents: p.revenueCents,
    }))
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 10);

  return {
    agent: { code: agent.agent_code, name: agent.full_name },
    days: safeDays,
    totalDeliveries: rows.length,
    zones: zoneList,
    topPartners: partnerList,
  };
}

async function getEarnings(rawCode) {
  await ensureOrderFlowSchema();
  const agent = await findAgent(rawCode);

  const { rows } = await pool.query(
    `SELECT o.id, o.delivery_code, o.status, o.created_at, o.delivered_at,
            o.delivery_fee_cents,
            o.rider_commission_cents,
            COALESCE(o.total_cents, ROUND(o.total_amount * 100)::int) AS total_cents,
            u.full_name AS customer_name,
            COALESCE(shop.shop_name, shop.business_name, 'Shop') AS shop_name
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
       AND o.delivered_at IS NOT NULL
     ORDER BY o.delivered_at DESC
     LIMIT 200`,
    [agent.id],
  );

  // Rider earns the delivery fee minus the platform's rider commission;
  // orders placed before commission pricing keep the full fee, and orders
  // with no fee at all fall back to the legacy 10%-of-total rule.
  const earningOf = (r) => {
    const fee = Number(r.delivery_fee_cents) || 0;
    if (fee > 0) {
      return Math.max(0, fee - (Number(r.rider_commission_cents) || 0));
    }
    return Math.round((Number(r.total_cents) || 0) * 0.10);
  };

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  let todayCents = 0;
  let weekCents = 0;
  let totalCents = 0;
  let deliveriesToday = 0;
  let deliveriesWeek = 0;

  const recent = rows.slice(0, 15).map((r) => {
    const earning = earningOf(r);
    totalCents += earning;
    const deliveredAt = r.delivered_at ? new Date(r.delivered_at) : null;
    if (deliveredAt && deliveredAt >= startOfToday) {
      todayCents += earning;
      deliveriesToday += 1;
    }
    if (deliveredAt && deliveredAt >= weekAgo) {
      weekCents += earning;
      deliveriesWeek += 1;
    }
    return {
      id: r.id,
      orderNumber: r.delivery_code || String(r.id).slice(0, 8).toUpperCase(),
      earningCents: earning,
      totalCents: Number(r.total_cents) || 0,
      shopName: r.shop_name || 'Ema Store Partner',
      customerName: r.customer_name || 'Customer',
      status: r.status,
      deliveredAt: r.delivered_at,
      createdAt: r.created_at,
    };
  });

  // Totals must cover ALL delivered orders, not just the recent 15.
  const { rows: totals } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN COALESCE(o.delivery_fee_cents, 0) > 0
         THEN GREATEST(o.delivery_fee_cents - COALESCE(o.rider_commission_cents, 0), 0)
         ELSE ROUND(COALESCE(o.total_cents, ROUND(o.total_amount * 100)::int) * 0.10) END) FILTER (
         WHERE o.delivered_at >= date_trunc('day', NOW())), 0)::bigint AS today_cents,
       COALESCE(SUM(CASE WHEN COALESCE(o.delivery_fee_cents, 0) > 0
         THEN GREATEST(o.delivery_fee_cents - COALESCE(o.rider_commission_cents, 0), 0)
         ELSE ROUND(COALESCE(o.total_cents, ROUND(o.total_amount * 100)::int) * 0.10) END) FILTER (
         WHERE o.delivered_at >= NOW() - INTERVAL '7 days'), 0)::bigint AS week_cents,
       COALESCE(SUM(CASE WHEN COALESCE(o.delivery_fee_cents, 0) > 0
         THEN GREATEST(o.delivery_fee_cents - COALESCE(o.rider_commission_cents, 0), 0)
         ELSE ROUND(COALESCE(o.total_cents, ROUND(o.total_amount * 100)::int) * 0.10) END), 0)::bigint AS total_cents,
       COUNT(*) FILTER (WHERE o.delivered_at >= date_trunc('day', NOW()))::int AS deliveries_today,
       COUNT(*) FILTER (WHERE o.delivered_at >= NOW() - INTERVAL '7 days')::int AS deliveries_week,
       COUNT(*)::int AS total_deliveries
     FROM orders o
     WHERE o.delivery_agent_id = $1 AND o.delivered_at IS NOT NULL`,
    [agent.id],
  );
  const t = totals[0] || {};

  // Wallet balance = escrow payouts already deposited to the rider's account.
  let walletCents = 0;
  const { rows: agentUserRows } = await pool.query(
    `SELECT u.id AS user_id FROM delivery_agents da
     JOIN users u ON u.phone = da.phone WHERE da.id = $1`,
    [agent.id],
  );
  if (agentUserRows[0]?.user_id) {
    const { rows: walletRows } = await pool.query(
      `SELECT COALESCE(SUM(amount) * 100, 0)::bigint AS settled
       FROM wallet_transactions
       WHERE user_id = $1 AND type = 'ORDER_PAYOUT' AND status = 'COMPLETED'`,
      [agentUserRows[0].user_id],
    );
    walletCents = Number(walletRows[0]?.settled ?? 0);
  }

  return {
    agent: { code: agent.agent_code, name: agent.full_name },
    walletBalanceCents: walletCents,
    todayCents: Math.round(Number(t.today_cents || 0)),
    weekCents: Math.round(Number(t.week_cents || 0)),
    totalCents: Math.round(Number(t.total_cents || 0)),
    deliveriesToday: t.deliveries_today || 0,
    deliveriesWeek: t.deliveries_week || 0,
    totalDeliveries: t.total_deliveries || 0,
    recent,
  };
}

// ── Overdue deliveries & rider problem reports ────────────────────────────────

/**
 * Rider reports a problem with their assigned delivery (e.g. customer
 * unreachable, wrong address). Requires a reason; notifies admins and
 * surfaces the order on the admin Overdue page.
 */
async function reportDeliveryIssue(rawCode, orderId, reason) {
  await ensureOrderFlowSchema();
  await ensureDeliveryIssueSchema();
  const agent = await findAgent(rawCode);
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 5) {
    throw new AppError('Please describe the problem (at least 5 characters).', 400, 'REASON_REQUIRED');
  }

  const { rows } = await pool.query(
    `UPDATE orders
     SET delivery_issue_reason = $2,
         delivery_issue_reported_at = NOW(),
         delivery_issue_resolved = FALSE,
         updated_at = NOW()
     WHERE id = $1
       AND delivery_agent_id = $3
       AND delivered_at IS NULL
       AND UPPER(COALESCE(status, '')) NOT IN
         ('CANCELLED', 'CANCELED', 'DELIVERED', 'COMPLETED', 'RETURNED', 'REFUNDED', 'FAILED')
     RETURNING id, delivery_code`,
    [orderId, trimmed.slice(0, 1000), agent.id],
  );
  if (!rows[0]) {
    throw new AppError('This delivery is not assigned to you or is already finished.', 409, 'NOT_ASSIGNED');
  }

  const { rows: admins } = await pool.query(
    `SELECT id FROM users WHERE UPPER(role) IN ('ADMIN', 'SUPER_ADMIN')`,
  );
  for (const admin of admins) {
    safeSendNotification(
      admin.id,
      'Delivery problem reported',
      `Rider ${agent.full_name} reported an issue on order #${String(rows[0].delivery_code || orderId).slice(0, 8)}: ${trimmed.slice(0, 120)}`,
      { orderId, type: 'DELIVERY_ISSUE', reason: trimmed.slice(0, 300) },
    );
  }
  return { ok: true, orderId };
}

/**
 * Admin: list deliveries that are overdue (> hours since accept) or have an
 * unresolved rider-reported issue.
 */
async function listOverdueDeliveries({ hours = 24, includeResolved = false } = {}) {
  await ensureOrderFlowSchema();
  await ensureDeliveryIssueSchema();
  const safeHours = Math.min(24 * 30, Math.max(1, Number(hours) || 24));
  const { rows } = await pool.query(
    `SELECT o.id, o.delivery_code, o.status, o.created_at, o.delivery_accepted_at,
            o.delivery_accepted_at + ($1 || ' hours')::interval AS deadline_at,
            o.delivery_issue_reason, o.delivery_issue_reported_at, o.delivery_issue_resolved,
            o.delivery_fee_cents, o.rider_commission_cents,
            o.shipping_address, o.handover_requested_at, o.rider_arrived_at,
            u.full_name AS customer_name, u.phone AS customer_phone,
            a.id AS agent_id, a.agent_code, a.full_name AS agent_name, a.phone AS agent_phone,
            COALESCE(shop.shop_name, shop.business_name, 'Shop') AS shop_name,
            COALESCE(shop.address, shop.city, 'Addis Ababa') AS shop_address
     FROM orders o
     JOIN users u ON u.id = o.user_id
     JOIN delivery_agents a ON a.id = o.delivery_agent_id
     LEFT JOIN LATERAL (
       SELECT p.partner_id FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = o.id
       LIMIT 1
     ) sp ON true
     LEFT JOIN partner_profile shop ON shop.user_id = sp.partner_id
     WHERE o.delivered_at IS NULL
       AND o.delivery_agent_id IS NOT NULL
       AND UPPER(COALESCE(o.status, '')) NOT IN
         ('CANCELLED', 'CANCELED', 'DELIVERED', 'COMPLETED', 'RETURNED', 'REFUNDED', 'FAILED')
       AND (
         o.delivery_accepted_at < NOW() - ($1 || ' hours')::interval
         OR (o.delivery_issue_reason IS NOT NULL AND o.delivery_issue_resolved = FALSE)
       )
       AND ($2::boolean OR o.delivery_issue_resolved = FALSE)
     ORDER BY o.delivery_accepted_at ASC NULLS LAST
     LIMIT 200`,
    [String(safeHours), includeResolved === true],
  );

  const orderIds = rows.map((r) => r.id);
  const itemsByOrder = {};
  if (orderIds.length > 0) {
    const { rows: itemRows } = await pool.query(
      `SELECT oi.order_id, p.name_en AS name, oi.quantity
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ANY($1::uuid[])`,
      [orderIds],
    );
    for (const r of itemRows) {
      (itemsByOrder[r.order_id] ||= []).push(`${r.name || 'Product'} x${Number(r.quantity) || 1}`);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    orderNumber: String(r.delivery_code || r.id).slice(0, 8).toUpperCase(),
    status: r.status,
    createdAt: r.created_at,
    acceptedAt: r.delivery_accepted_at,
    deadlineAt: r.deadline_at,
    overdueHours: r.delivery_accepted_at
      ? Math.max(0, Math.floor((Date.now() - new Date(r.delivery_accepted_at).getTime()) / 3600000))
      : null,
    issueReason: r.delivery_issue_reason || null,
    issueReportedAt: r.delivery_issue_reported_at || null,
    issueResolved: r.delivery_issue_resolved === true,
    deliveryFeeCents: Number(r.delivery_fee_cents) || 0,
    riderEarningCents: Math.max(0, (Number(r.delivery_fee_cents) || 0) - (Number(r.rider_commission_cents) || 0)),
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    shippingAddress: r.shipping_address,
    shopName: r.shop_name,
    shopAddress: r.shop_address,
    handoverRequestedAt: r.handover_requested_at,
    riderArrivedAt: r.rider_arrived_at,
    agent: {
      id: r.agent_id,
      agentCode: r.agent_code,
      name: r.agent_name,
      phone: r.agent_phone,
    },
    items: itemsByOrder[r.id] || [],
  }));
}

/**
 * Admin: reassign an in-flight delivery.
 * - agentCode given → assign to that rider (they keep full control).
 * - no agentCode → release back to the open offers pool (same reset as a
 *   rider decline) so any available rider can pick it up.
 */
async function reassignDelivery(orderId, { agentCode } = {}) {
  await ensureOrderFlowSchema();
  await ensureDeliveryIssueSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, status, delivery_agent_id, delivered_at, delivery_code
       FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = rows[0];
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    if (order.delivered_at ||
        ['CANCELLED', 'CANCELED', 'DELIVERED', 'COMPLETED', 'RETURNED', 'REFUNDED', 'FAILED']
          .includes(String(order.status || '').toUpperCase())) {
      throw new AppError('This order is already finished.', 409, 'ORDER_FINISHED');
    }

    if (agentCode) {
      const agent = await findAgent(agentCode); // throws if unknown/inactive
      await client.query(
        `UPDATE orders
         SET delivery_agent_id = $2,
             delivery_accepted_at = NOW(),
             delivery_issue_resolved = TRUE,
             updated_at = NOW()
         WHERE id = $1`,
        [orderId, agent.id],
      );
      await client.query('COMMIT');
      const { rows: admins } = await pool.query(
        `SELECT id FROM users WHERE UPPER(role) IN ('ADMIN', 'SUPER_ADMIN')`,
      );
      for (const admin of admins) {
        safeSendNotification(
          admin.id,
          'Delivery reassigned',
          `Order #${String(order.delivery_code || orderId).slice(0, 8)} was reassigned to ${agent.full_name} (${agent.agent_code}).`,
          { orderId, type: 'DELIVERY_REASSIGNED', agentCode: agent.agent_code },
        );
      }
      return { ok: true, orderId, action: 'ASSIGNED', agentCode: agent.agent_code, agentName: agent.full_name };
    }

    // Release back to the offers pool — same reset as declineOffer.
    await client.query(
      `UPDATE orders
       SET delivery_agent_id = NULL,
           delivery_accepted_at = NULL,
           handover_requested_at = NULL,
           handover_proof = NULL,
           handed_over_at = NULL,
           handover_code = NULL,
           rider_arrived_at = NULL,
           delivery_issue_resolved = TRUE,
           status = CASE WHEN status = 'SHIPPED' THEN 'PACKED' ELSE status END,
           updated_at = NOW()
       WHERE id = $1`,
      [orderId],
    );
    await client.query('COMMIT');
    await notifyRidersOfNewOffer(orderId);
    return { ok: true, orderId, action: 'RELEASED' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Road route between two points via OSRM — returns distance, duration,
 * geometry coordinates and turn steps for the rider navigation map.
 */
async function getRoute({ fromLat, fromLng, toLat, toLng }) {
  const fLat = Number(fromLat), fLng = Number(fromLng);
  const tLat = Number(toLat), tLng = Number(toLng);
  if (![fLat, fLng, tLat, tLng].every(Number.isFinite) ||
      Math.abs(fLat) > 90 || Math.abs(tLat) > 90 ||
      Math.abs(fLng) > 180 || Math.abs(tLng) > 180) {
    throw new AppError('Valid coordinates are required.', 400, 'INVALID_COORDS');
  }
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${fLng},${fLat};${tLng},${tLat}` +
    `?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(9000),
    headers: { 'User-Agent': 'ema-store-backend/1.0' },
  });
  if (!res.ok) throw new AppError('Routing service unavailable.', 502, 'ROUTING_FAILED');
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route) throw new AppError('No route found between these points.', 404, 'NO_ROUTE');

  const coords = (route.geometry?.coordinates ?? [])
    .filter((c) => Array.isArray(c) && c.length >= 2)
    .map((c) => [Number(c[1]), Number(c[0])]); // [lat, lng]

  // Cumulative distance per vertex for progress tracking.
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const [aLat, aLng] = coords[i - 1];
    const [bLat, bLng] = coords[i];
    const dLat = (bLat - aLat) * Math.PI / 180;
    const dLng = (bLng - aLng) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    cum.push(cum[i - 1] + 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
  }

  const steps = [];
  let stepStart = 0;
  for (const leg of route.legs ?? []) {
    for (const s of leg.steps ?? []) {
      const m = s.maneuver ?? {};
      const dist = Number(s.distance) || 0;
      steps.push({
        instruction: _stepInstruction(m.type, m.modifier, s.name),
        startM: stepStart,
        endM: stepStart + dist,
        durationSec: Number(s.duration) || 0,
      });
      stepStart += dist;
    }
  }

  return {
    distanceM: Number(route.distance) || 0,
    durationSec: Number(route.duration) || 0,
    coordinates: coords,
    cumDistance: cum,
    steps,
  };
}

function _stepInstruction(type, modifier, name) {
  const on = name ? ` onto ${name}` : '';
  switch (type) {
    case 'depart': return `Head out${name ? ` onto ${name}` : ''}`;
    case 'arrive': return 'Arrive at destination';
    case 'turn': return `Turn ${modifier || ''}${on}`.replace(/\s+/g, ' ').trim();
    case 'new name': return `Continue${on}`;
    case 'merge': return `Merge ${modifier ? `${modifier} ` : ''}${on}`.trim();
    case 'fork': return `Keep ${modifier || 'straight'}${on}`;
    case 'on ramp': return `Take the ramp${on}`;
    case 'off ramp': return `Take the exit${on}`;
    case 'roundabout':
    case 'rotary': return `Enter the roundabout${on}`;
    case 'exit roundabout':
    case 'exit rotary': return `Exit the roundabout${on}`;
    case 'uturn': return `Make a U-turn${on}`;
    default: return `Continue ${modifier ? `${modifier} ` : ''}${on}`.trim();
  }
}

module.exports = {
  getAgentQr,
  listOffers,
  acceptOffer,
  declineOffer,
  getActiveDeliveries,
  getActiveDelivery,
  confirmPickup,
  scanDelivery,
  markArrived,
  getDeliveryHistory,
  getEarnings,
  getWalletTransactions,
  getNotifications,
  markNotificationsRead,
  getDeliveryZones,
  updateAgentLocation,
  processOverdueDeliveries,
  notifyRidersOfNewOffer,
  reportDeliveryIssue,
  listOverdueDeliveries,
  reassignDelivery,
  getRoute,
};