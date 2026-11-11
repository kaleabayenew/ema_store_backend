const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// ============================================================================
// ORDERS SERVICE
// Handles order creation and management
// ============================================================================

// ── Create Order from Cart or Direct Items ─────────────────────────────────

async function createOrder(userId, shippingAddress, paymentMethod, directItems = null) {
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

        // Query product details
        const { rows: productRows } = await client.query(`
          SELECT id, stock, price_cents, discount_cents, coin_price
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
        });
      }
    } else {
      // Get cart items
      const { rows: cartItems } = await client.query(`
        SELECT ci.*, p.stock, p.price_cents, p.discount_cents, p.coin_price
        FROM cart_items ci
        JOIN products p ON ci.product_id = p.id
        WHERE ci.user_id = $1
      `, [userId]);

      if (cartItems.length === 0) {
        throw new AppError('Cart is empty', 400, 'EMPTY_CART');
      }

      // Check stock for cart items
      for (const item of cartItems) {
        if (item.stock < item.quantity) {
          throw new AppError(`Insufficient stock for product`, 400, 'INSUFFICIENT_STOCK');
        }
      }

      itemsToOrder = cartItems;
    }

    // Calculate total
    let totalCents = 0;
    for (const item of itemsToOrder) {
      const price = item.discount_cents > 0 ? item.discount_cents : item.price_cents;
      totalCents += price * item.quantity;
    }

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

    // Create order (wallet-paid orders start as PAID)
    const orderStatus = walletPayment ? 'PAID' : 'PENDING';
    const { rows: orderRows } = await client.query(`
      INSERT INTO orders (user_id, total_cents, total_amount, status, shipping_address, payment_method)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [userId, totalCents, totalCents / 100.0, orderStatus, shippingAddress, paymentMethod]);

    const order = orderRows[0];

    // Create order items and update stock
    for (const item of itemsToOrder) {
      const priceCents = item.discount_cents > 0 ? item.discount_cents : item.price_cents;

      await client.query(`
        INSERT INTO order_items (order_id, product_id, quantity, price_at_order)
        VALUES ($1, $2, $3, $4)
      `, [order.id, item.product_id, item.quantity, priceCents]);

      await client.query(`
        UPDATE products
        SET stock = stock - $1, sold_count = sold_count + $1
        WHERE id = $2
      `, [item.quantity, item.product_id]);
    }

    // Clear cart only if we used cart items
    if (!directItems) {
      await client.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);
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
      o.id,
      o.user_id,
      o.status,
      o.payment_method,
      o.shipping_address,
      o.created_at,
      o.updated_at,
      o.total_cents,
      COALESCE(o.total_amount, o.total_cents / 100.0) AS total_amount,
      COUNT(oi.id)::int AS item_count
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.user_id = $1
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT $2 OFFSET $3
  `, [userId, limit, offset]);

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
      COUNT(oi.id)::int                                                      AS item_count
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN customer_user cu ON cu.user_id = o.user_id
    LEFT JOIN order_items oi ON o.id = oi.order_id
    ${where}
    GROUP BY o.id, cu.full_name, u.phone, u.email
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

async function updateOrderStatus(orderId, status) {
  const { rows } = await pool.query(`
    UPDATE orders
    SET status = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `, [status, orderId]);

  if (rows.length === 0) {
    throw new AppError('Order not found', 404, 'NOT_FOUND');
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
      u.email                                             AS customer_email
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN customer_user cu ON cu.user_id = o.user_id
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
      p.name_en,
      p.name_am,
      p.name_om,
      COALESCE(p.name_en, p.name_am, p.name_om, 'Product') AS product_name,
      pi.image_url
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = true
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
      items: itemRows.map((i) => ({
        id: i.id,
        productName: i.product_name,
        productImage: i.image_url ?? null,
        quantity: i.quantity,
        priceAtOrder: parseFloat(i.price_at_order) / 100,  // cents → ETB
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
    })),
  };
}

module.exports = {
  createOrder,
  getUserOrders,
  getAllOrders,
  updateOrderStatus,
  getOrderById,
};
