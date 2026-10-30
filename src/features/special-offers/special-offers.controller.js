const service = require('./special-offers.service');
const { ok, created, noContent } = require('../../core/utils/response');

async function getActiveOffers(req, res, next) {
  try {
    const offers = await service.getActiveSpecialOffers();
    ok(res, { offers });
  } catch (error) {
    next(error);
  }
}

async function getOfferById(req, res, next) {
  try {
    const { id } = req.params;
    const offer = await service.getSpecialOfferById(id);
    ok(res, { offer });
  } catch (error) {
    next(error);
  }
}

async function createOffer(req, res, next) {
  try {
    const offer = await service.createSpecialOffer(req.body);
    created(res, { offer });
  } catch (error) {
    next(error);
  }
}

async function updateOffer(req, res, next) {
  try {
    const { id } = req.params;
    const offer = await service.updateSpecialOffer(id, req.body);
    ok(res, { offer });
  } catch (error) {
    next(error);
  }
}

async function deleteOffer(req, res, next) {
  try {
    const { id } = req.params;
    await service.deleteSpecialOffer(id);
    noContent(res);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getActiveOffers,
  getOfferById,
  createOffer,
  updateOffer,
  deleteOffer,
};
