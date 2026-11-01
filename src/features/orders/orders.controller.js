const service = require('./orders.service');
const { ok, created, error } = require('../../core/utils/response');

// ── POST /api/v1/orders
// Create order from cart
const createOrder = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { shippingAddress, paymentMethod } = req.body;

    const order = await service.createOrder(userId, shippingAddress, paymentMethod);

    created(res, order);
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/orders
// Get user's orders
const getUserOrders = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { limit, offset } = req.query;

    const orders = await service.getUserOrders(
      userId,
      parseInt(limit) || 20,
      parseInt(offset) || 0
    );

    ok(res, { orders, count: orders.length });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/orders/:id
// Get specific order
const getOrderById = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const order = await service.getOrderById(id, userId);

    ok(res, order);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createOrder,
  getUserOrders,
  getOrderById,
};
