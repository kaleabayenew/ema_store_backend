const service = require('./products.service');
const { ok, created, error } = require('../../core/utils/response');

// ── GET /api/v1/products
// Query: ?category=&search=&status=&partnerId=&limit=&page=
// Get all products with filters + pagination
const getAllProducts = async (req, res, next) => {
  try {
    const { category, search, status, partnerId } = req.query;
    const limit = parseInt(req.query.limit) || 15;
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * limit;

    const { products, total, approved, pending, avgRating } = await service.getAllProducts({
      category,
      search,
      status,
      partnerId,
      limit,
      offset,
    });

    ok(res, {
      products,
      count: products.length,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      approved,
      pending,
      avgRating: parseFloat(avgRating.toFixed(1)),
    });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/products/:id
// Get a specific product by ID
const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const product = await service.getProductById(id);

    ok(res, product);
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/products
// Create a new product (requires auth)
const createProduct = async (req, res, next) => {
  try {
    const data = req.body;

    const product = await service.createProduct(data);

    created(res, product);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/v1/products/:id
// Update a product (requires auth)
const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const product = await service.updateProduct(id, data);

    ok(res, { message: 'Product updated successfully', product });
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/v1/products/:id
// Delete a product (requires auth)
const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;

    await service.deleteProduct(id);

    ok(res, { message: 'Product deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/categories
// Get all categories
const getAllCategories = async (req, res, next) => {
  try {
    const categories = await service.getAllCategories();

    ok(res, { categories, count: categories.length });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/products/:id/reviews
// Get reviews for a product
const getProductReviews = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { limit, offset } = req.query;

    const reviews = await service.getProductReviews(
      id,
      parseInt(limit) || 20,
      parseInt(offset) || 0,
    );

    ok(res, { reviews, count: reviews.length });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/products/new-arrivals
// Query: ?limit=
// Get newest products
const getNewArrivals = async (req, res, next) => {
  try {
    const { limit } = req.query;

    const products = await service.getNewArrivals({
      limit: parseInt(limit) || 5,
    });

    ok(res, { products, count: products.length });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/products/flash-deals
// Query: ?limit=
// Get products with discounts (flash deals)
const getFlashDealProducts = async (req, res, next) => {
  try {
    const { limit } = req.query;

    const products = await service.getFlashDealProducts({
      limit: parseInt(limit) || 10,
    });

    ok(res, { products, count: products.length });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/products/popular
// Query: ?limit=
// Get popular products (sorted by rating and sales)
const getPopularProducts = async (req, res, next) => {
  try {
    const { limit } = req.query;

    const products = await service.getPopularProducts({
      limit: parseInt(limit) || 10,
    });

    ok(res, { products, count: products.length });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getAllCategories,
  getProductReviews,
  getNewArrivals,
  getFlashDealProducts,
  getPopularProducts,
};
