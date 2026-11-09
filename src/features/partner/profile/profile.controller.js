const service = require('./profile.service');
const { ok, error } = require('../../../core/utils/response');

const getProfile = async (req, res, next) => {
  try {
    const profile = await service.getProfile(req.user.id);
    ok(res, { profile });
  } catch (err) {
    next(err);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const profile = await service.updateProfile(req.user.id, req.body);
    ok(res, { profile });
  } catch (err) {
    next(err);
  }
};

const updateLogo = async (req, res, next) => {
  try {
    const { logoUrl } = req.body;
    if (!logoUrl) return error(res, 'logoUrl is required.', 400, 'MISSING_FIELDS');
    const profile = await service.updateLogo(req.user.id, logoUrl);
    ok(res, { profile });
  } catch (err) {
    next(err);
  }
};

module.exports = { getProfile, updateProfile, updateLogo };
