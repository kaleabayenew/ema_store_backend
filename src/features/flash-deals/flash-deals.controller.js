const service = require('./flash-deals.service');
const { ok, error, created } = require('../../core/utils/response');

// ── POST /api/v1/flash-deals
// Body: { title, description, discountPercent, productIds?, categoryIds?, startsAt, endsAt, imageUrl }
// Create a new flash deal
const createFlashDeal = async (req, res, next) => {
  try {
    const {
      title,
      description,
      discountPercent,
      productIds,
      categoryIds,
      startsAt,
      endsAt,
      imageUrl,
    } = req.body;

    const createdBy = req.user?.id;

    if (!title || !discountPercent || !startsAt || !endsAt) {
      return error(res, 'title, discountPercent, startsAt, and endsAt are required.', 400, 'MISSING_FIELDS');
    }

    if (discountPercent < 1 || discountPercent > 100) {
      return error(res, 'discountPercent must be between 1 and 100.', 400, 'INVALID_DISCOUNT');
    }

    const deal = await service.createFlashDeal({
      title,
      description,
      discountPercent,
      productIds,
      categoryIds,
      startsAt,
      endsAt,
      imageUrl,
      createdBy,
    });

    created(res, deal);
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/flash-deals
// Query: ?includeExpired=false&limit=20&offset=0
// Get all flash deals
const getAllFlashDeals = async (req, res, next) => {
  try {
    const includeExpired = req.query.includeExpired === 'true';
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const deals = await service.getAllFlashDeals({
      includeExpired,
      limit,
      offset,
    });

    ok(res, { deals, limit, offset, count: deals.length });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/flash-deals/active
// Get currently active flash deals (for customers)
const getActiveFlashDeals = async (req, res, next) => {
  try {
    const deals = await service.getActiveFlashDeals();

    ok(res, { deals, count: deals.length });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/flash-deals/:id
// Get a specific flash deal
const getFlashDealById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const deal = await service.getFlashDealById(id);

    ok(res, deal);
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/flash-deals/:id/products
// Get products in a flash deal with applied discounts
const getFlashDealProducts = async (req, res, next) => {
  try {
    const { id } = req.params;

    const products = await service.getFlashDealProducts(id);

    ok(res, { products, count: products.length });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/v1/flash-deals/:id
// Update a flash deal
const updateFlashDeal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const deal = await service.updateFlashDeal(id, updates);

    ok(res, { message: 'Flash deal updated successfully', deal });
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/v1/flash-deals/:id
// Delete a flash deal
const deleteFlashDeal = async (req, res, next) => {
  try {
    const { id } = req.params;

    await service.deleteFlashDeal(id);

    ok(res, { message: 'Flash deal deleted successfully' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createFlashDeal,
  getAllFlashDeals,
  getActiveFlashDeals,
  getFlashDealById,
  getFlashDealProducts,
  updateFlashDeal,
  deleteFlashDeal,
};
