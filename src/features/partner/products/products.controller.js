const service = require('./products.service');
const { ok, created, error } = require('../../../core/utils/response');

const getProducts = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    const { page, limit, search } = req.query;
    const result = await service.getProducts(partnerId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      search,
    });
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const getProduct = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    const product = await service.getProduct(partnerId, req.params.id);
    ok(res, { product });
  } catch (err) {
    next(err);
  }
};

const createProduct = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    const product = await service.createProduct(partnerId, req.body);
    created(res, { product });
  } catch (err) {
    next(err);
  }
};

const updateProduct = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    const product = await service.updateProduct(partnerId, req.params.id, req.body);
    ok(res, { product });
  } catch (err) {
    next(err);
  }
};

const deleteProduct = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    await service.deleteProduct(partnerId, req.params.id);
    ok(res, { message: 'Product deleted.' });
  } catch (err) {
    next(err);
  }
};

const toggleVisibility = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    const result = await service.toggleVisibility(partnerId, req.params.id);
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const uploadImage = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    const { imageUrl } = req.body;
    if (!imageUrl) return error(res, 'imageUrl is required.', 400, 'MISSING_FIELDS');
    const image = await service.uploadImage(partnerId, req.params.id, imageUrl);
    created(res, { image });
  } catch (err) {
    next(err);
  }
};

const deleteImage = async (req, res, next) => {
  try {
    const partnerId = req.user.id;
    await service.deleteImage(partnerId, req.params.id, req.params.imgId);
    ok(res, { message: 'Image deleted.' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProducts, getProduct, createProduct, updateProduct,
  deleteProduct, toggleVisibility, uploadImage, deleteImage,
};
