const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');
const {
  ensureOrderFlowSchema,
  generateDeliveryCode,
  safeSendNotification,
  parseAddressPin,
} = require('./order_flow');

// ============================================================================
// ORDERS SERVICE
// Handles order creation and management
// ============================================================================

// ── Create Order from Cart or Direct Items ─────────────────────────────────

async function createOrder(userId, shippingAddress, paymentMethod, directItems = null, { deliveryMethod = null, paymentId = null, idempotencyKey = null, couponCode = null } = {}) {
  await ensureOrderFlowSchema();
  // Cash on delivery is disabled — the rider must never hold product money.
  // All orders must be prepaid (Telebirr/CBE/wallet/coins) so the escrow
  // payouts always have collected funds behind them.
  if (/cash|cod/i.test(String(paymentMethod || ''))) {
    throw new AppError(
      'Cash on delivery is no longer available. Please pay online before ordering.',
      400,
      'COD_DISABLED',
    );
  }

  // ── Delivery location is mandatory and fully specified ──────────────
  // The customer must provide a complete address AND drop a map pin — the
  // pin drives the delivery-fee distance and the rider's navigation.
  const addrText = String(shippingAddress || '').trim();
  if (addrText.length < 10) {
    throw new AppError(
      'A complete delivery address is required.',
      400,
      'ADDRESS_REQUIRED',
    );
  }
  const dropPin = parseAddressPin(addrText);
  if (dropPin.lat == null || dropPin.lng == null) {
    throw new AppError(
      'Please drop a pin on the map for your delivery location.',
      400,
      'LOCATION_PIN_REQUIRED',
    );
  }
  // Delivery method is system-controlled — the customer never picks a
  // courier; every order is fulfilled by the rider network.
  deliveryMethod = 'RIDER_DELIVERY';
  // Idempotent replay: a retried checkout (e.g. after a client timeout)
  // returns the original order instead of charging/creating twice.
  if (idempotencyKey) {
    const { rows: dup } = await pool.query(
      `SELECT * FROM orders WHERE idempotency_key = $1 AND user_id = $2`,
      [idempotencyKey, userId],
    );
    if (dup.length > 0) {
      // Same raw-row shape as the normal RETURNING * path below.
      return { ...dup[0], duplicate: true };
    }
  }

  // coin_price may be missing if startup migration failed — add lazily so
  // order queries never break.
  try {
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS coin_price INTEGER`);
  } catch (e) { /* best-effort */ }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let itemsToOrder;

    // If directItems is provided, use them; otherwise use cart
    if (directItems && Array.isArray(directItems) && directItems.length > 0) {
      // Validate and get product details for direct items
      itemsToOrder = [];
      for (const item of directItems) {
        const { productId, quantity } = item;

        // Quantity must be a positive integer — a negative value would
        // invert the total and mint balance/coins on wallet payments.
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
          throw new AppError('Quantity must be a whole number between 1 and 99.', 400, 'INVALID_QUANTITY');
        }

        // Query product details
        const { rows: productRows } = await client.query(`
          SELECT id, stock, price_cents, discount_cents, coin_price, name_en, partner_id
          FROM products
          WHERE id = $1
        `, [productId]);

        if (productRows.length === 0) {
          throw new AppError(`Product not found: ${productId}`, 404, 'PRODUCT_NOT_FOUND');
        }

        const product = productRows[0];

        // Validate stock
        if (product.stock < quantity) {
          throw new AppError(`Insufficient stock for product`, 400, 'INSUFFICIENT_STOCK');
        }

        itemsToOrder.push({
          product_id: productId,
          quantity,
          stock: product.stock,
          price_cents: product.price_cents,
          discount_cents: product.discount_cents,
          coin_price: product.coin_price,
          name_en: product.name_en,
          partner_id: product.partner_id,
          promotion_id: item.promotionId || item.promotion_id || null,
        });
      }
    } else {
      // Get cart items
      const { rows: cartItems } = await client.query(`
        SELECT ci.*, p.stock, p.price_cents, p.discount_cents, p.coin_price, p.name_en, p.partner_id
        FROM cart_items ci
        JOIN products p ON ci.product_id = p.id
        WHERE ci.user_id = $1
      `, [userId]);

      if (cartItems.length === 0) {
        throw new AppError('Cart is empty', 400, 'EMPTY_CART');
      }

      // Check stock for cart items (also guards against bad rows written
      // before quantity validation existed).
      for (const item of cartItems) {
        if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
          throw new AppError('Invalid quantity in cart. Please update your cart.', 400, 'INVALID_QUANTITY');
        }
        if (item.stock < item.quantity) {
          throw new AppError(`Insufficient stock for product`, 400, 'INSUFFICIENT_STOCK');
        }
      }

      itemsToOrder = cartItems;
    }

    // Resolve seasonal-promotion pricing per item. A promo only applies
    // when it is active, contains the product, and was the context the
    // customer bought through (cart_items.promotion_id or item.promotionId).
    const { resolvePromotionForProduct } = require('../seasonal-promotions/seasonal-promotions.service');
    for (const item of itemsToOrder) {
      const requested = item.promotion_id || item.promotionId || null;
      if (!requested) continue;
      try {
        const promo = await resolvePromotionForProduct(item.product_id, requested);
        if (promo && promo.discount_percent > 0) {
          item.promotion_id = promo.id;
          item.promo_price_cents = Math.round(
            item.price_cents * (1 - promo.discount_percent / 100),
          );
        }
      } catch (_) { /* promo lookup is best-effort — never block checkout */ }
    }

    // Calculate total
    let totalCents = 0;
    for (const item of itemsToOrder) {
      const hasDiscount = item.discount_cents > 0 && item.discount_cents < item.price_cents;
      const normalPrice = hasDiscount ? (item.price_cents - item.discount_cents) : item.price_cents;
      const price = item.promo_price_cents ?? normalPrice;
      totalCents += price * item.quantity;
    }

    // ── Coupon redemption ─────────────────────────────────────────────
    // The customer must own an unused claim of the coupon; the discount is
    // computed server-side from the real order total — never trusted from
    // the client.
    let couponId = null;
    let couponCodeApplied = null;
    let couponDiscountCents = 0;
    let userCouponId = null;
    if (couponCode) {
      const { validateCouponForOrder } = require('../marketing/marketing.service');
      const result = await validateCouponForOrder(userId, couponCode, totalCents, client);
      couponId = result.coupon.id;
      couponCodeApplied = result.coupon.code;
      couponDiscountCents = result.discountCents;
      userCouponId = result.userCouponId;
      totalCents -= couponDiscountCents;
    }

    // ── Delivery fee ──────────────────────────────────────────────────
    // Distance (shop→customer) + weight + material pricing. The customer
    // always pays it on top of the (coupon-discounted) product total; the
    // rider earns the full fee on delivery. Coupons never discount the fee.
    const feeSvc = require('../delivery/delivery_fee.service');
    await feeSvc.ensureFeeSchema();
    const feeItems = itemsToOrder.map((i) => ({
      name: i.name_en || i.name || 'Product',
      quantity: i.quantity,
      partnerId: i.partner_id,
    }));
    const { feeCents: deliveryFeeCents, legs: feeLegs } = await feeSvc.computeOrderFee({
      items: feeItems,
      shippingAddress,
    });

    // ── Platform commissions ─────────────────────────────────────────
    // productCents = coupon-discounted product subtotal (pre-fee total).
    // Customer pays a service fee per shop leg (first leg full price,
    // extra partner locations discounted); the platform keeps the service
    // fee + partner commission + rider commission.
    const productCents = totalCents;
    const feeSettings = await feeSvc.getSettings();
    const legsCount = feeLegs.length || 1;
    const serviceFeeCents = feeSvc.serviceFeeForLegs(feeSettings, legsCount);
    const partnerCommissionPct = feeSettings.partnerCommissionPct;
    const riderCommissionCents = Math.round(
      (deliveryFeeCents * feeSettings.riderCommissionPct) / 100,
    );
    totalCents += deliveryFeeCents + serviceFeeCents;

    // ── Wallet payments: COINS or BALANCE ──────────────────────────────
    // 'COINS'   → every item must have a coin_price; total is in coins.
    // 'BALANCE' → total is the ETB order total charged from users.balance.
    const walletPayment = paymentMethod === 'COINS' ? 'COINS'
      : (paymentMethod === 'BALANCE' || paymentMethod === 'WALLET_BALANCE') ? 'BALANCE'
        : null;

    let coinsTotal = 0;
    let coinsPerUnit = 100;
    let balanceTotal = totalCents / 100;

    if (walletPayment === 'COINS') {
      const { getCoinSettings } = require('../admin/credits.service');
      const settings = await getCoinSettings();
      if (!settings.coinBuyEnabled) {
        throw new AppError('Coin payments are currently disabled', 403, 'COIN_BUY_DISABLED');
      }
      coinsPerUnit = settings.coinsPerUnit || 100;
      for (const item of itemsToOrder) {
        const cp = parseInt(item.coin_price, 10);
        if (!Number.isFinite(cp) || cp <= 0) {
          throw new AppError('One or more items cannot be bought with coins', 400, 'COIN_PRICE_MISSING');
        }
        coinsTotal += cp * item.quantity;
      }
    }

    if (walletPayment) {
      const { rows: userRows } = await client.query(
        'SELECT coins, balance FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (userRows.length === 0) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }
      const user = userRows[0];
      if (walletPayment === 'COINS' && parseInt(user.coins, 10) < coinsTotal) {
        throw new AppError('Insufficient coins', 400, 'INSUFFICIENT_COINS');
      }
      if (walletPayment === 'BALANCE' && parseFloat(user.balance) < balanceTotal) {
        throw new AppError('Insufficient balance', 400, 'INSUFFICIENT_BALANCE');
      }
    }

    // Step 1: Customer buys/orders the product -> order is CONFIRMED automatically,
    // delivery_code is generated, and payment_status is initialized.
    const orderStatus = 'CONFIRMED';
    const paymentStatus = walletPayment ? 'PAID' : 'PENDING';
    const deliveryCode = generateDeliveryCode();

    const orderPartnerCommissionCents = Math.round(
      (productCents * partnerCommissionPct) / 100,
    );
    const { rows: orderRows } = await client.query(`
      INSERT INTO orders (user_id, total_cents, total_amount, status, shipping_address, payment_method, delivery_method, payment_id, idempotency_key, coupon_id, coupon_code, discount_cents, delivery_code, payment_status, delivery_fee_cents, service_fee_cents, partner_commission_cents, rider_commission_cents, dropoff_lat, dropoff_lng)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *
    `, [userId, totalCents, totalCents / 100.0, orderStatus, shippingAddress, paymentMethod, deliveryMethod, paymentId, idempotencyKey || null, couponId, couponCodeApplied, couponDiscountCents, deliveryCode, paymentStatus, deliveryFeeCents, serviceFeeCents, orderPartnerCommissionCents, riderCommissionCents, dropPin.lat, dropPin.lng]);

    const order = orderRows[0];

    // Create order items and update stock. Each item carries its own
    // partner commission so multi-partner orders deduct correctly.
    let partnerCommissionCents = 0;
    for (const item of itemsToOrder) {
      const hasDiscount = item.discount_cents > 0 && item.discount_cents < item.price_cents;
      const normalPrice = hasDiscount ? (item.price_cents - item.discount_cents) : item.price_cents;
      const priceCents = item.promo_price_cents ?? normalPrice;
      const itemCommissionCents = Math.round(
        (priceCents * item.quantity * partnerCommissionPct) / 100,
      );
      partnerCommissionCents += itemCommissionCents;

      await client.query(`
        INSERT INTO order_items (order_id, product_id, quantity, price_at_order, promotion_id, commission_cents)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [order.id, item.product_id, item.quantity, priceCents, item.promotion_id || null, itemCommissionCents]);

      // Atomic stock decrement — the WHERE guard prevents overselling when
      // two orders race for the last unit (the earlier SELECT is not locked).
      const { rowCount: stockUpdated } = await client.query(`
        UPDATE products
        SET stock = stock - $1, sold_count = sold_count + $1
        WHERE id = $2 AND stock >= $1
      `, [item.quantity, item.product_id]);
      if (stockUpdated === 0) {
        throw new AppError('Insufficient stock for one or more items', 400, 'INSUFFICIENT_STOCK');
      }
    }

    // Sync the order-level partner commission with the exact per-item sum.
    if (partnerCommissionCents !== orderPartnerCommissionCents) {
      await client.query(
        'UPDATE orders SET partner_commission_cents = $1 WHERE id = $2',
        [partnerCommissionCents, order.id],
      );
    }

    // Clear cart only if we used cart items
    if (!directItems) {
      await client.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);
    }

    // Mark the coupon as redeemed (inside the same transaction).
    if (userCouponId) {
      const { markCouponUsed } = require('../marketing/marketing.service');
      await markCouponUsed(userCouponId, order.id, client);
    }

    // Deduct wallet funds + record the transaction for wallet-paid orders.
    if (walletPayment === 'COINS') {
      await client.query(
        'UPDATE users SET coins = coins - $1 WHERE id = $2',
        [coinsTotal, userId]
      );
      await client.query(
        `INSERT INTO wallet_transactions (user_id, title, description, amount, type, status, metadata)
         VALUES ($1, $2, $3, $4, 'COIN_PURCHASE', 'COMPLETED', $5)`,
        [
          userId,
          'Coin purchase',
          `Order ${order.id} paid with ${coinsTotal} coins`,
          -(coinsTotal / coinsPerUnit),
          JSON.stringify({ orderId: order.id, coins: coinsTotal, items: itemsToOrder.length }),
        ]
      );
    } else if (walletPayment === 'BALANCE') {
      await client.query(
        'UPDATE users SET balance = balance - $1 WHERE id = $2',
        [balanceTotal, userId]
      );
      await client.query(
        `INSERT INTO wallet_transactions (user_id, title, description, amount, type, status, metadata)
         VALUES ($1, $2, $3, $4, 'BALANCE_PURCHASE', 'COMPLETED', $5)`,
        [
          userId,
          'Balance purchase',
          `Order ${order.id} paid from balance`,
          -balanceTotal,
          JSON.stringify({ orderId: order.id, amountETB: balanceTotal }),
        ]
      );
    }

    await client.query('COMMIT');

    // Notify partner(s) and customer of the new order
    try {
      const { rows: partnerRows } = await pool.query(
        `SELECT DISTINCT p.partner_id FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1`,
        [order.id],
      );
      for (const pr of partnerRows) {
        if (pr.partner_id) {
          safeSendNotification(
            pr.partner_id,
            'New Order Received',
            `You have received a new order #${order.delivery_code || order.id.slice(0, 8)}.`,
            {
              orderId: order.id,
              type: 'NEW_ORDER',
              deliveryCode: order.delivery_code,
              localNotification: 'true',
            },
          );
        }
      }

      // Notify customer
      safeSendNotification(
        userId,
        'Order Confirmed',
        `Your order #${order.delivery_code || order.id.slice(0, 8)} has been confirmed!`,
        { orderId: order.id, type: 'ORDER_PLACED', deliveryCode: order.delivery_code },
      );

      require('../delivery/delivery.service')
        .notifyRidersOfNewOffer(order.id)
        .catch((err) =>
          console.error('[notify] Rider offer notification failed:', err.message || err),
        );
    } catch (notifErr) {
      console.error('[notify] Order creation notification failed:', notifErr.message);
    }

    return order;
  } catch (err) {
    await client.query('ROLLBACK');
    // Unique-violation on idempotency_key = a concurrent retry won the race.
    if (idempotencyKey && err && err.code === '23505') {
      const { rows: dup } = await pool.query(
        `SELECT * FROM orders WHERE idempotency_key = $1 AND user_id = $2`,
        [idempotencyKey, userId],
      );
      if (dup.length > 0) return { ...dup[0], duplicate: true };
    }
    throw err;
  } finally {
    client.release();
  }
}

// ── Get User Orders ─────────────────────────────────────────────────────

async function getUserOrders(userId, limit = 20, offset = 0) {
  const { rows } = await pool.query(`
    SELECT
      o.id,
      o.user_id,
      o.status,
      o.payment_method,
      o.shipping_address,
      o.created_at,
      o.updated_at,
      o.total_cents,
      COALESCE(o.total_amount, o.total_cents / 100.0) AS total_amount,
      COUNT(oi.id)::int AS item_count,
      o.delivery_code,
      o.delivery_agent_id,
      o.handed_over_at,
      o.delivery_accepted_at,
      o.handover_requested_at,
      o.delivery_requested_at,
      o.delivered_at,
      o.customer_accepted_at,
      o.customer_rejected_at,
      o.payment_status,
      o.rider_arrived_at,
      da.full_name AS delivery_agent_name,
      da.phone AS delivery_agent_phone,
      da.agent_code AS delivery_agent_code
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN delivery_agents da ON da.id = o.delivery_agent_id
    WHERE o.user_id = $1
    GROUP BY o.id, da.id
    ORDER BY o.created_at DESC
    LIMIT $2 OFFSET $3
  `, [userId, limit, offset]);

  // Fetch items (with promo info) for each order
  const orderIds = rows.map((r) => r.id);
  let itemsByOrder = {};
  if (orderIds.length > 0) {
    const placeholders = orderIds.map((_, i) => `$${i + 1}`).join(',');
    const { rows: itemRows } = await pool.query(`
      SELECT
        oi.id,
        oi.order_id,
        oi.product_id,
        oi.quantity,
        oi.price_at_order,
        oi.promotion_id,
        sp.title          AS promotion_title,
        sp.discount_percent AS promotion_discount_percent,
        p.name_en,
        p.name_am,
        p.name_om,
        pi.image_url
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = true
      LEFT JOIN seasonal_promotions sp ON oi.promotion_id = sp.id
      WHERE oi.order_id IN (${placeholders})
      ORDER BY oi.order_id, oi.id
    `, orderIds);

    for (const item of itemRows) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push({
        id: item.id,
        order_id: item.order_id,
        product_id: item.product_id,
        quantity: item.quantity,
        price_at_order: parseFloat(item.price_at_order),
        name_en: item.name_en,
        name_am: item.name_am,
        name_om: item.name_om,
        image_url: item.image_url ?? null,
        promotion_id: item.promotion_id ?? null,
        promotion_title: item.promotion_title ?? null,
        promotion_discount_percent: item.promotion_discount_percent ?? null,
      });
    }
  }

  // Return snake_case fields — Flutter OrdersRepository._fromJson reads these directly
  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    status: r.status,
    payment_method: r.payment_method,
    shipping_address: r.shipping_address,
    created_at: r.created_at,
    updated_at: r.updated_at,
    total_cents: r.total_cents ?? Math.round(parseFloat(r.total_amount ?? 0) * 100),
    total_amount: parseFloat(r.total_amount ?? 0),
    item_count: r.item_count,
    delivery_code: r.delivery_code || null,
    delivery_agent_id: r.delivery_agent_id || null,
    delivery_agent_name: r.delivery_agent_name || null,
    delivery_agent_phone: r.delivery_agent_phone || null,
    delivery_agent_code: r.delivery_agent_code || null,
    handover_requested_at: r.handover_requested_at || null,
    delivery_requested_at: r.delivery_requested_at || null,
    delivered_at: r.delivered_at || null,
    customer_accepted_at: r.customer_accepted_at || null,
    customer_rejected_at: r.customer_rejected_at || null,
    payment_status: r.payment_status || 'PENDING',
    handed_over_at: r.handed_over_at || null,
    delivery_accepted_at: r.delivery_accepted_at || null,
    rider_arrived_at: r.rider_arrived_at || null,
    items: itemsByOrder[r.id] || [],
  }));
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

  // Count filtered rows
  const { rows: countRows } = await pool.query(`
    SELECT COUNT(DISTINCT o.id)::int AS total
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN customer_user cu ON cu.user_id = o.user_id
    ${where}
  `, params);
  const total = countRows[0]?.total ?? 0;

  // Aggregate stats (always over all orders, unfiltered)
  const { rows: statsRows } = await pool.query(`
    SELECT
      COUNT(*)::int                                                       AS total_all,
      COUNT(*) FILTER (WHERE status = 'DELIVERED')::int                  AS delivered,
      COUNT(*) FILTER (WHERE status IN ('SHIPPED','IN_TRANSIT'))::int     AS in_transit,
      COUNT(*) FILTER (WHERE status = 'CANCELLED')::int                  AS cancelled,
      COALESCE(SUM(COALESCE(total_cents, ROUND(total_amount * 100)::int)) / 100.0, 0) AS total_revenue
    FROM orders
  `);
  const stats = statsRows[0] ?? {};

  const { rows } = await pool.query(`
    SELECT
      o.id,
      o.status,
      o.payment_method,
      o.shipping_address,
      o.created_at,
      o.updated_at,
      COALESCE(o.total_cents, ROUND(o.total_amount * 100)::int)              AS total_cents,
      COALESCE(o.total_amount, o.total_cents / 100.0)                        AS total_amount,
      COALESCE(cu.full_name, u.phone, 'Customer')                            AS customer_name,
      u.phone                                                                AS customer_phone,
      u.email                                                                AS customer_email,
      o.delivery_code,
      da.full_name                                                           AS delivery_agent_name,
      da.agent_code                                                          AS delivery_agent_code,
      COUNT(oi.id)::int                                                      AS item_count
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN customer_user cu ON cu.user_id = o.user_id
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN delivery_agents da ON da.id = o.delivery_agent_id
    ${where}
    GROUP BY o.id, cu.full_name, u.phone, u.email, da.id
    ORDER BY o.created_at DESC
    LIMIT $${idx} OFFSET $${idx + 1}
  `, [...params, limit, offset]);

  return {
    orders: rows.map((r) => ({
      id: r.id,
      status: r.status,
      totalAmount: parseFloat(r.total_amount ?? (r.total_cents ? r.total_cents / 100 : 0)),
      shippingAddress: r.shipping_address ?? '',
      paymentMethod: r.payment_method ?? 'Telebirr',
      customerName: r.customer_name,
      customerPhone: r.customer_phone ?? '',
      customerEmail: r.customer_email ?? '',
      itemCount: r.item_count,
      deliveryCode: r.delivery_code || null,
      deliveryAgentName: r.delivery_agent_name || null,
      deliveryAgentCode: r.delivery_agent_code || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    page,
    limit,
    // Stats card data
    delivered: parseInt(stats.delivered ?? 0, 10),
    inTransit: parseInt(stats.in_transit ?? 0, 10),
    cancelled: parseInt(stats.cancelled ?? 0, 10),
    totalRevenue: parseFloat(stats.total_revenue ?? 0),
  };
}

// ── Update Order Status (Admin) ──────────────────────────────────────────

const ORDER_STATUSES = new Set([
  'PENDING', 'PENDING_PAYMENT', 'PAID', 'PLACED', 'CONFIRMED', 'PROCESSING',
  'PACKED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'REFUNDED',
]);

// Mirrors the admin panel's transition rules — terminal states are final.
const ALLOWED_TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['CONFIRMED', 'PROCESSING', 'CANCELLED'],
  PLACED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'PACKED', 'CANCELLED'],
  PROCESSING: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['IN_TRANSIT', 'DELIVERED'],
  IN_TRANSIT: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
};

async function updateOrderStatus(orderId, status) {
  const next = String(status || '').toUpperCase();
  if (!ORDER_STATUSES.has(next)) {
    throw new AppError('Invalid order status.', 400, 'INVALID_STATUS');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: current } = await client.query(
      `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    if (current.length === 0) {
      throw new AppError('Order not found', 404, 'NOT_FOUND');
    }
    const order = current[0];

    const prev = String(order.status || '').toUpperCase();
    const allowed = ALLOWED_TRANSITIONS[prev];
    if (allowed && !allowed.includes(next)) {
      throw new AppError(
        `Cannot move order from ${prev} to ${next}.`,
        400,
        'INVALID_STATUS_TRANSITION',
      );
    }

    // Cancellation is only allowed before the rider picks up the package.
    if (next === 'CANCELLED' && order.handed_over_at) {
      throw new AppError(
        'This order cannot be cancelled — the rider has already picked it up.',
        400,
        'ALREADY_PICKED_UP',
      );
    }

    const { rows } = await client.query(`
      UPDATE orders
      SET status = $1,
          delivered_at = CASE WHEN $1 = 'DELIVERED' AND status <> 'DELIVERED' THEN NOW() ELSE delivered_at END,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [next, orderId]);

    // Escrow: if this transition delivers the order (admin path), settle
    // the remaining partner share + rider earning. Idempotent via
    // order_payouts.paid_cents.
    if (next === 'DELIVERED' && prev !== 'DELIVERED' && rows[0]) {
      const escrow = require('../delivery/escrow.service');
      await escrow.settleDeliveryPayouts(client, rows[0]);
    }

    // Cancellation: restock items, refund wallet payments, release coupon.
    if (next === 'CANCELLED' && prev !== 'CANCELLED' && prev !== 'REFUNDED') {
      const { rows: cancelItems } = await client.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
        [orderId],
      );
      for (const ci of cancelItems) {
        await client.query(
          `UPDATE products
           SET stock = stock + $1,
               sold_count = GREATEST(sold_count - $1, 0)
           WHERE id = $2`,
          [ci.quantity, ci.product_id],
        );
      }

      // Refund wallet payments — reverse the original purchase transaction.
      const { rows: payTx } = await client.query(
        `SELECT id, type, amount, metadata FROM wallet_transactions
         WHERE metadata->>'orderId' = $1::text
           AND type IN ('COIN_PURCHASE', 'BALANCE_PURCHASE')
           AND status = 'COMPLETED'
         ORDER BY created_at DESC LIMIT 1`,
        [orderId],
      );
      const pay = payTx[0];
      if (pay) {
        const meta = typeof pay.metadata === 'string' ? JSON.parse(pay.metadata) : (pay.metadata || {});
        if (pay.type === 'BALANCE_PURCHASE') {
          const refundEtb = Math.abs(Number(pay.amount) || 0);
          if (refundEtb > 0) {
            await client.query(
              'UPDATE users SET balance = balance + $1 WHERE id = $2',
              [refundEtb, order.user_id],
            );
            await client.query(
              `INSERT INTO wallet_transactions (user_id, amount, title, description, type, status, metadata)
               VALUES ($1, $2, 'Order refund', $3, 'REFUND', 'COMPLETED', $4)`,
              [order.user_id, refundEtb,
               `Refund for cancelled order ${order.delivery_code || String(orderId).slice(0, 8)}`,
               JSON.stringify({ orderId, refundOf: pay.id })],
            );
          }
        } else if (pay.type === 'COIN_PURCHASE') {
          const coins = parseInt(meta.coins, 10) || 0;
          if (coins > 0) {
            await client.query(
              'UPDATE users SET coins = coins + $1 WHERE id = $2',
              [coins, order.user_id],
            );
            await client.query(
              `INSERT INTO wallet_transactions (user_id, amount, title, description, type, status, metadata)
               VALUES ($1, $2, 'Order refund', $3, 'REFUND', 'COMPLETED', $4)`,
              [order.user_id, -(coins / 100),
               `Coin refund for cancelled order ${order.delivery_code || String(orderId).slice(0, 8)}`,
               JSON.stringify({ orderId, refundOf: pay.id, coins })],
            );
          }
        }
      }

      // Release the redeemed coupon so the customer can use it again.
      if (order.coupon_id && order.user_id) {
        await client.query(
          `UPDATE user_coupons SET is_used = false, used_at = NULL
           WHERE user_id = $1 AND coupon_id = $2 AND is_used = true`,
          [order.user_id, order.coupon_id],
        );
      }
    }

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Admin confirms an online payment (Telebirr/CBE transaction reference was
// verified) so the order can settle on delivery.
async function confirmOrderPayment(orderId) {
  const { rows } = await pool.query(
    `UPDATE orders
     SET payment_status = 'PAID',
         paid_at = COALESCE(paid_at, NOW()),
         updated_at = NOW()
     WHERE id = $1 AND COALESCE(payment_status, 'PENDING') <> 'PAID'
     RETURNING id, status, payment_status, payment_method, delivery_agent_id`,
    [orderId],
  );
  if (rows.length === 0) {
    const { rows: existing } = await pool.query(
      'SELECT id, payment_status FROM orders WHERE id = $1', [orderId],
    );
    if (!existing[0]) throw new AppError('Order not found', 404, 'NOT_FOUND');
    return existing[0]; // already paid — idempotent
  }
  const { getOfferAcceptanceBlock } = require('../delivery/offer_rules');
  if (!rows[0].delivery_agent_id && !getOfferAcceptanceBlock(rows[0])) {
    require('../delivery/delivery.service')
      .notifyRidersOfNewOffer(orderId)
      .catch((err) =>
        console.error('[notify] Rider offer notification failed:', err.message || err),
      );
  }
  return rows[0];
}

// ── Get Order by ID ───────────────────────────────────────────────────────
// forAdmin=true  → camelCase + priceAtOrder in ETB (÷100) for web
// forAdmin=false → snake_case + raw cents for Flutter

async function getOrderById(orderId, userId = null, forAdmin = false) {
  const baseQuery = `
    SELECT
      o.id, o.status, o.payment_method, o.shipping_address,
      o.created_at, o.updated_at,
      o.total_cents,
      o.user_id,
      COALESCE(o.total_amount, o.total_cents / 100.0)   AS total_amount,
      COALESCE(cu.full_name, u.phone, 'Customer')        AS customer_name,
      u.phone                                             AS customer_phone,
      u.email                                             AS customer_email,
      o.delivery_code,
      o.delivery_agent_id,
      o.handed_over_at,
      o.delivery_accepted_at,
      o.handover_requested_at,
      o.delivery_requested_at,
      o.delivered_at,
      o.customer_accepted_at,
      o.customer_rejected_at,
      o.payment_status,
      o.rider_arrived_at,
      da.full_name AS delivery_agent_name,
      da.phone AS delivery_agent_phone,
      da.agent_code AS delivery_agent_code
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN customer_user cu ON cu.user_id = o.user_id
    LEFT JOIN delivery_agents da ON da.id = o.delivery_agent_id
    WHERE o.id = $1
    ${userId ? 'AND o.user_id = $2' : ''}
  `;
  const params = userId ? [orderId, userId] : [orderId];

  const { rows } = await pool.query(baseQuery, params);

  if (rows.length === 0) {
    throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  }

  const row = rows[0];

  const { rows: itemRows } = await pool.query(`
    SELECT
      oi.id,
      oi.order_id,
      oi.product_id,
      oi.quantity,
      oi.price_at_order,
      oi.promotion_id,
      sp.title AS promo_title,
      sp.discount_percent AS promo_discount_percent,
      p.name_en,
      p.name_am,
      p.name_om,
      COALESCE(p.name_en, p.name_am, p.name_om, 'Product') AS product_name,
      pi.image_url
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = true
    LEFT JOIN seasonal_promotions sp ON oi.promotion_id = sp.id
    WHERE oi.order_id = $1
  `, [orderId]);

  if (forAdmin) {
    // Web admin — camelCase, prices in ETB (price_at_order stored as cents)
    return {
      id: row.id,
      status: row.status,
      totalAmount: parseFloat(row.total_amount ?? 0),
      shippingAddress: row.shipping_address ?? '',
      paymentMethod: row.payment_method ?? 'Telebirr',
      customerName: row.customer_name,
      customerPhone: row.customer_phone ?? '',
      customerEmail: row.customer_email ?? '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deliveryCode: row.delivery_code || null,
      deliveryAgentId: row.delivery_agent_id || null,
      deliveryAgentName: row.delivery_agent_name || null,
      deliveryAgentPhone: row.delivery_agent_phone || null,
      deliveryAgentCode: row.delivery_agent_code || null,
      handoverRequestedAt: row.handover_requested_at || null,
      handedOverAt: row.handed_over_at || null,
      deliveryAcceptedAt: row.delivery_accepted_at || null,
      riderArrivedAt: row.rider_arrived_at || null,
      deliveryRequestedAt: row.delivery_requested_at || null,
      deliveredAt: row.delivered_at || null,
      customerAcceptedAt: row.customer_accepted_at || null,
      customerRejectedAt: row.customer_rejected_at || null,
      paymentStatus: row.payment_status || 'PENDING',
      items: itemRows.map((i) => ({
        id: i.id,
        productName: i.product_name,
        productImage: i.image_url ?? null,
        quantity: i.quantity,
        priceAtOrder: parseFloat(i.price_at_order) / 100,  // cents → ETB
        promotionId: i.promotion_id ?? null,
        promotionTitle: i.promo_title ?? null,
        promotionDiscountPercent: i.promo_discount_percent ?? null,
      })),
    };
  }

  // Flutter customer — snake_case, prices as raw cents
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    payment_method: row.payment_method,
    shipping_address: row.shipping_address,
    created_at: row.created_at,
    updated_at: row.updated_at,
    total_cents: row.total_cents ?? Math.round(parseFloat(row.total_amount ?? 0) * 100),
    total_amount: parseFloat(row.total_amount ?? 0),
    delivery_code: row.delivery_code || null,
    delivery_agent_id: row.delivery_agent_id || null,
    delivery_agent_name: row.delivery_agent_name || null,
    delivery_agent_phone: row.delivery_agent_phone || null,
    delivery_agent_code: row.delivery_agent_code || null,
    handover_requested_at: row.handover_requested_at || null,
    delivery_requested_at: row.delivery_requested_at || null,
    delivered_at: row.delivered_at || null,
    customer_accepted_at: row.customer_accepted_at || null,
    customer_rejected_at: row.customer_rejected_at || null,
    payment_status: row.payment_status || 'PENDING',
    handed_over_at: row.handed_over_at || null,
    delivery_accepted_at: row.delivery_accepted_at || null,
    rider_arrived_at: row.rider_arrived_at || null,
    items: itemRows.map((i) => ({
      id: i.id,
      order_id: i.order_id,
      product_id: i.product_id,
      quantity: i.quantity,
      price_at_order: parseFloat(i.price_at_order),  // raw cents for Flutter
      name_en: i.name_en,
      name_am: i.name_am,
      name_om: i.name_om,
      image_url: i.image_url ?? null,
      promotion_id: i.promotion_id ?? null,
      promotion_title: i.promo_title ?? null,
      promotion_discount_percent: i.promo_discount_percent ?? null,
    })),
  };
}

// ── Customer Pending Receipt & Confirmation ──────────────────────────────

async function getPendingReceipt(userId) {
  await ensureOrderFlowSchema();
  const { rows } = await pool.query(
    `SELECT o.id, o.status, o.total_amount, o.total_cents, o.delivery_code,
            o.delivery_requested_at, o.delivery_proof, o.created_at,
            da.full_name AS delivery_agent_name, da.phone AS delivery_agent_phone,
            da.agent_code AS delivery_agent_code
     FROM orders o
     LEFT JOIN delivery_agents da ON da.id = o.delivery_agent_id
     WHERE o.user_id = $1
       AND o.delivery_requested_at IS NOT NULL
       AND o.customer_accepted_at IS NULL
       AND o.status != 'CANCELLED'
     ORDER BY o.delivery_requested_at DESC
     LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return null;
  const order = rows[0];
  return {
    id: order.id,
    orderNumber: String(order.delivery_code || order.id).slice(0, 8).toUpperCase(),
    totalAmount: Number(order.total_amount) || (order.total_cents ? order.total_cents / 100 : 0),
    deliveryCode: order.delivery_code,
    deliveryRequestedAt: order.delivery_requested_at,
    deliveryProof: order.delivery_proof,
    deliveryAgent: order.delivery_agent_code ? {
      name: order.delivery_agent_name,
      phone: order.delivery_agent_phone,
      code: order.delivery_agent_code,
    } : null,
  };
}

async function receiveOrder(userId, orderId) {
  await ensureOrderFlowSchema();
  const client = await pool.connect();
  let updatedOrder;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT o.id, o.status, o.user_id, o.delivery_agent_id, o.delivery_requested_at, o.delivery_code,
              o.total_cents, o.total_amount, o.delivery_fee_cents, o.rider_commission_cents,
              o.payment_status, o.payment_method
       FROM orders o
       WHERE o.id = $1 AND o.user_id = $2
       FOR UPDATE`,
      [orderId, userId],
    );
    const order = rows[0];
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }
    if (!order.delivery_requested_at) {
      throw new AppError('Delivery has not been requested for this order yet.', 400, 'DELIVERY_NOT_REQUESTED');
    }

    // Never settle payouts for unpaid orders — wallet payments are already
    // PAID; Telebirr/CBE must be confirmed by an admin first.
    if (String(order.payment_status || '').toUpperCase() !== 'PAID') {
      throw new AppError(
        'Payment for this order has not been confirmed yet.',
        400,
        'PAYMENT_NOT_CONFIRMED',
      );
    }

    const { rows: updateRows } = await client.query(
      `UPDATE orders
       SET status = 'DELIVERED',
           delivered_at = NOW(),
           customer_accepted_at = NOW(),
           payment_status = 'PAID',
           paid_at = COALESCE(paid_at, NOW()),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [orderId],
    );
    updatedOrder = updateRows[0];

    // Escrow: deposit remaining partner share + full rider earning.
    const escrow = require('../delivery/escrow.service');
    await escrow.settleDeliveryPayouts(client, order);

    await client.query('COMMIT');

    // Notify Partner
    const { rows: partnerRows } = await pool.query(
      `SELECT DISTINCT p.partner_id
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [orderId],
    );
    for (const pr of partnerRows) {
      safeSendNotification(
        pr.partner_id,
        'Order Delivered & Paid!',
        `Order #${order.delivery_code || order.id.slice(0, 8)} was accepted by the customer and payment is settled.`,
        { orderId, type: 'ORDER_DELIVERED' }
      );
    }

    // Notify Rider if assigned
    if (order.delivery_agent_id) {
      const { rows: agentRows } = await pool.query(
        `SELECT u.id AS user_id FROM delivery_agents da
         JOIN users u ON u.phone = da.phone
         WHERE da.id = $1`,
        [order.delivery_agent_id],
      );
      if (agentRows[0]) {
        safeSendNotification(
          agentRows[0].user_id,
          'Delivery Completed!',
          `Customer accepted order #${order.delivery_code || order.id.slice(0, 8)}. Great job!`,
          { orderId, type: 'DELIVERY_COMPLETED' }
        );
      }
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return updatedOrder;
}


// Customer rejects the delivered package — rider must retry the handover.
async function rejectDelivery(userId, orderId) {
  await ensureOrderFlowSchema();
  const client = await pool.connect();
  let updatedOrder;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT o.id, o.status, o.user_id, o.delivery_agent_id, o.delivery_requested_at,
              o.customer_accepted_at, o.delivery_code
       FROM orders o
       WHERE o.id = $1 AND o.user_id = $2
       FOR UPDATE`,
      [orderId, userId],
    );
    const order = rows[0];
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }
    if (!order.delivery_requested_at) {
      throw new AppError('Delivery has not been requested for this order yet.', 400, 'DELIVERY_NOT_REQUESTED');
    }
    if (order.customer_accepted_at) {
      throw new AppError('This delivery was already accepted.', 400, 'ALREADY_ACCEPTED');
    }

    const { rows: updateRows } = await client.query(
      `UPDATE orders
       SET customer_rejected_at = NOW(),
           delivery_requested_at = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [orderId],
    );
    updatedOrder = updateRows[0];
    await client.query('COMMIT');

    // Notify the assigned rider (via linked user account) to retry.
    if (order.delivery_agent_id) {
      const { rows: agentRows } = await pool.query(
        `SELECT u.id AS user_id FROM delivery_agents da
         JOIN users u ON u.phone = da.phone
         WHERE da.id = $1`,
        [order.delivery_agent_id],
      );
      if (agentRows[0]) {
        safeSendNotification(
          agentRows[0].user_id,
          'Customer declined the delivery',
          `Order #${order.delivery_code || orderId.slice(0, 8)} was not accepted. Please contact the customer and retry.`,
          { orderId, type: 'DELIVERY_REJECTED' },
        );
      }
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return updatedOrder;
}

// ── Live tracking ───────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RIDER_LIVE_WINDOW_MS = 2 * 60 * 1000; // a fix older than this is "stale"

/** Maps the raw order row to a customer-friendly stage. */
function computeTrackingStage(row) {
  const status = String(row.status || '').toUpperCase();
  const hasRider = !!row.delivery_agent_id;

  if (status === 'CANCELLED') {
    return { stage: 'CANCELLED', label: 'Order cancelled', holder: 'PARTNER', stepIndex: 0 };
  }
  if (status === 'DELIVERED' || row.delivered_at) {
    return { stage: 'DELIVERED', label: 'Delivered', holder: 'CUSTOMER', stepIndex: 4 };
  }
  if (status === 'SHIPPED') {
    if (row.rider_arrived_at) {
      return { stage: 'ARRIVED', label: 'Rider has arrived', holder: 'RIDER', stepIndex: 3 };
    }
    return { stage: 'ON_THE_WAY', label: 'On the way to you', holder: 'RIDER', stepIndex: 3 };
  }
  if (status === 'PACKED') {
    return hasRider
      ? { stage: 'RIDER_TO_SHOP', label: 'Packed - rider is collecting it', holder: 'PARTNER', stepIndex: 2 }
      : { stage: 'READY_FOR_PICKUP', label: 'Packed - waiting for a rider', holder: 'PARTNER', stepIndex: 2 };
  }
  if (status === 'CONFIRMED' || status === 'PROCESSING') {
    return hasRider
      ? { stage: 'RIDER_TO_SHOP', label: 'Rider is heading to the shop', holder: 'PARTNER', stepIndex: 1 }
      : { stage: 'PREPARING', label: 'Shop is preparing your order', holder: 'PARTNER', stepIndex: 1 };
  }
  return { stage: 'PLACED', label: 'Order placed', holder: 'PARTNER', stepIndex: 0 };
}

/**
 * GET /orders/:id/tracking — where the package is right now.
 * Returns the customer's drop-off pin, the shop pin, and the rider's last GPS
 * fix (only while a rider is assigned and the order is still in progress).
 */
async function getOrderTracking(orderId, userId) {
  await ensureOrderFlowSchema();
  if (!UUID_RE.test(String(orderId || ''))) {
    throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  }

  const { rows } = await pool.query(
    `SELECT o.id, o.status, o.shipping_address, o.delivery_agent_id,
            o.handover_requested_at, o.handed_over_at, o.rider_arrived_at,
            o.delivered_at, o.updated_at,
            da.full_name AS rider_name, da.phone AS rider_phone,
            da.last_lat, da.last_lng, da.last_location_at,
            shop.shop_name, shop.address AS shop_address,
            shop.shop_lat, shop.shop_lng
       FROM orders o
       LEFT JOIN delivery_agents da ON da.id = o.delivery_agent_id
       LEFT JOIN LATERAL (
         SELECT p.partner_id
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = o.id
          LIMIT 1
       ) sp ON true
       LEFT JOIN partner_profile shop ON shop.user_id = sp.partner_id
      WHERE o.id = $1 AND o.user_id = $2`,
    [orderId, userId],
  );
  if (rows.length === 0) {
    throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  }
  const r = rows[0];
  const info = computeTrackingStage(r);
  const finished = info.stage === 'DELIVERED' || info.stage === 'CANCELLED';

  // Customer drop-off pin (saved by the app inside the shipping address).
  const dropoff = parseAddressPin(r.shipping_address);

  // Shop pin: saved coordinates first, then any "Pin:" inside the address.
  let shopLat = r.shop_lat !== null && r.shop_lat !== undefined ? Number(r.shop_lat) : null;
  let shopLng = r.shop_lng !== null && r.shop_lng !== undefined ? Number(r.shop_lng) : null;
  if (shopLat === null || shopLng === null || !Number.isFinite(shopLat) || !Number.isFinite(shopLng)) {
    const fromAddr = parseAddressPin(r.shop_address);
    shopLat = fromAddr.lat;
    shopLng = fromAddr.lng;
  }

  // Rider (only while the job is in progress).
  let rider = null;
  if (r.delivery_agent_id && !finished) {
    const fixAt = r.last_location_at ? new Date(r.last_location_at) : null;
    const hasFix = r.last_lat !== null && r.last_lat !== undefined &&
                   r.last_lng !== null && r.last_lng !== undefined;
    rider = {
      name: r.rider_name || 'Courier',
      phone: r.rider_phone || null,
      lat: hasFix ? Number(r.last_lat) : null,
      lng: hasFix ? Number(r.last_lng) : null,
      updatedAt: fixAt ? fixAt.toISOString() : null,
      isLive: !!(hasFix && fixAt && Date.now() - fixAt.getTime() <= RIDER_LIVE_WINDOW_MS),
      arrived: !!r.rider_arrived_at,
    };
  }

  return {
    orderId: r.id,
    status: r.status,
    stage: info.stage,
    stageLabel: info.label,
    stepIndex: info.stepIndex,
    holder: info.holder, // PARTNER | RIDER | CUSTOMER
    finished,
    customer: {
      address: r.shipping_address || null,
      lat: dropoff.lat,
      lng: dropoff.lng,
    },
    partner: {
      name: r.shop_name || 'Shop',
      address: r.shop_address || null,
      lat: Number.isFinite(shopLat) ? shopLat : null,
      lng: Number.isFinite(shopLng) ? shopLng : null,
    },
    rider,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    serverTime: new Date().toISOString(),
  };
}

module.exports = {
  createOrder,
  getUserOrders,
  getAllOrders,
  updateOrderStatus,
  confirmOrderPayment,
  getOrderById,
  getPendingReceipt,
  receiveOrder,
  rejectDelivery,
  getOrderTracking,
};