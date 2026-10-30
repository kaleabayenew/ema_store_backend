const service = require('./products.service');
const { ok, created, error } = require('../../core/utils/response');

// ── GET /api/v1/products
// Query: ?category=&search=&status=&partnerId=&limit=&offset=
// Get all products with filters
const getAllProducts = async (req, res, next) => {
  try {
    const { category, search, status, partnerId, limit, offset } = req.query;

    const products = await service.getAllProducts({
      category,
      search,
      status,
      partnerId,
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0,
    });

    ok(res, { products, count: products.length });
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

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getAllCategories,
  getProductReviews,
};
