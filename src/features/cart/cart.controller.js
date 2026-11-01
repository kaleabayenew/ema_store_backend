const service = require('./cart.service');
const { ok, created, error } = require('../../core/utils/response');

// ── GET /api/v1/cart
// Get user's cart
const getUserCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const cart = await service.getUserCart(userId);

    ok(res, { cart, count: cart.length });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/cart
// Add item to cart
const addToCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId, quantity } = req.body;

    const result = await service.addToCart(userId, productId, quantity);

    created(res, result);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/v1/cart/:itemId
// Update cart item quantity
const updateCartItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;
    const { quantity } = req.body;

    const result = await service.updateCartItem(userId, itemId, quantity);

    ok(res, result);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/v1/cart/:itemId
// Remove item from cart
const removeFromCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;

    const result = await service.removeFromCart(userId, itemId);

    ok(res, result);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/v1/cart
// Clear entire cart
const clearCart = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await service.clearCart(userId);

    ok(res, result);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getUserCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
};
