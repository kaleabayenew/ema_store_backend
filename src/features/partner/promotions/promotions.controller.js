const service = require('./promotions.service');
const { ok, created } = require('../../../core/utils/response');

const getPromotions = async (req, res, next) => {
  try {
    const promotions = await service.getPromotions(req.user.id);
    ok(res, { promotions });
  } catch (err) {
    next(err);
  }
};

const createPromotion = async (req, res, next) => {
  try {
    const promotion = await service.createPromotion(req.user.id, req.body);
    created(res, { promotion });
  } catch (err) {
    next(err);
  }
};

const updatePromotion = async (req, res, next) => {
  try {
    const promotion = await service.updatePromotion(req.user.id, req.params.id, req.body);
    ok(res, { promotion });
  } catch (err) {
    next(err);
  }
};

const deletePromotion = async (req, res, next) => {
  try {
    await service.deletePromotion(req.user.id, req.params.id);
    ok(res, { message: 'Promotion deleted.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getPromotions, createPromotion, updatePromotion, deletePromotion };
