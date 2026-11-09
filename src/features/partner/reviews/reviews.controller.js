const service = require('./reviews.service');
const { ok, error } = require('../../../core/utils/response');

const getReviews = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await service.getReviews(req.user.id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
    });
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const replyToReview = async (req, res, next) => {
  try {
    const { replyText } = req.body;
    if (!replyText) return error(res, 'replyText is required.', 400, 'MISSING_FIELDS');
    const review = await service.replyToReview(req.user.id, req.params.id, replyText);
    ok(res, { review });
  } catch (err) {
    next(err);
  }
};

module.exports = { getReviews, replyToReview };
