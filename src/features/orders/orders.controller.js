const service = require('./orders.service');
const { ok, created } = require('../../core/utils/response');

// ── POST /api/v1/orders
// Create order from cart or direct items
const createOrder = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { shippingAddress, paymentMethod, items } = req.body;

    const order = await service.createOrder(userId, shippingAddress, paymentMethod, items);

    created(res, { order });
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
      parseInt(limit, 10) || 20,
      parseInt(offset, 10) || 0
    );

    ok(res, { orders, count: orders.length });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/orders/admin/all
// Admin get all orders
const getAllOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const result = await service.getAllOrders({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      status,
      search,
    });
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/v1/orders/:id/status
// Admin update status
const updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const order = await service.updateOrderStatus(id, status);
    ok(res, { order });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/orders/admin/:id
// Admin get specific order (no userId restriction, returns ETB prices)
const getAdminOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await service.getOrderById(id, null, true); // forAdmin=true
    ok(res, { order });
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
  getAllOrders,
  getAdminOrderById,
  updateStatus,
  getOrderById,
};
