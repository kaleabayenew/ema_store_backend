const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// ============================================================================
// CART SERVICE
// Handles shopping cart operations
// ============================================================================

// ── Get User Cart ─────────────────────────────────────────────────────────

async function getUserCart(userId) {
  const { rows } = await pool.query(`
    SELECT
      ci.*,
      p.name_en,
      p.name_am,
      p.name_om,
      p.price_cents,
      p.discount_cents,
      p.stock,
      pi.image_url
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = true
    WHERE ci.user_id = $1
    ORDER BY ci.created_at DESC
  `, [userId]);

  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    quantity: row.quantity,
    priceAtAdd: row.price_at_add,
    nameEn: row.name_en,
    nameAm: row.name_am,
    nameOm: row.name_om,
    priceCents: row.price_cents,
    discountCents: row.discount_cents,
    stock: row.stock,
    imageUrl: row.image_url,
    createdAt: row.created_at,
  }));
}

// ── Add Item to Cart ─────────────────────────────────────────────────────

async function addToCart(userId, productId, quantity = 1) {
  // Check if product exists and has stock
  const { rows: productRows } = await pool.query(
    'SELECT id, stock, price_cents FROM products WHERE id = $1',
    [productId]
  );

  if (productRows.length === 0) {
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  const product = productRows[0];

  if (product.stock < quantity) {
    throw new AppError('Insufficient stock', 400, 'INSUFFICIENT_STOCK');
  }

  // Check if item already in cart
  const { rows: existing } = await pool.query(
    'SELECT id, quantity FROM cart_items WHERE user_id = $1 AND product_id = $2',
    [userId, productId]
  );

  if (existing.length > 0) {
    // Update quantity
    const newQuantity = existing[0].quantity + quantity;
    await pool.query(
      'UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2',
      [newQuantity, existing[0].id]
    );
    return { message: 'Cart updated', quantity: newQuantity };
  }

  // Add new item
  const { rows } = await pool.query(`
    INSERT INTO cart_items (user_id, product_id, quantity, price_at_add)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [userId, productId, quantity, product.price_cents]);

  return rows[0];
}

// ── Update Cart Item Quantity ─────────────────────────────────────────────

async function updateCartItem(userId, cartItemId, quantity) {
  if (quantity <= 0) {
    await pool.query(
      'DELETE FROM cart_items WHERE id = $1 AND user_id = $2',
      [cartItemId, userId]
    );
    return { message: 'Item removed from cart' };
  }

  const { rows } = await pool.query(`
    UPDATE cart_items
    SET quantity = $1, updated_at = NOW()
    WHERE id = $2 AND user_id = $3
    RETURNING *
  `, [quantity, cartItemId, userId]);

  if (rows.length === 0) {
    throw new AppError('Cart item not found', 404, 'CART_ITEM_NOT_FOUND');
  }

  return rows[0];
}

// ── Remove Item from Cart ────────────────────────────────────────────────

async function removeFromCart(userId, cartItemId) {
  const { rows } = await pool.query(
    'DELETE FROM cart_items WHERE id = $1 AND user_id = $2 RETURNING *',
    [cartItemId, userId]
  );

  if (rows.length === 0) {
    throw new AppError('Cart item not found', 404, 'CART_ITEM_NOT_FOUND');
  }

  return { message: 'Item removed from cart' };
}

// ── Clear Cart ───────────────────────────────────────────────────────────

async function clearCart(userId) {
  await pool.query('DELETE FROM cart_items WHERE user_id = $1', [userId]);
  return { message: 'Cart cleared' };
}

module.exports = {
  getUserCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
};
