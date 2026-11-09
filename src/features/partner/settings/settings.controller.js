const service = require('./settings.service');
const { ok, error } = require('../../../core/utils/response');

const getSettings = async (req, res, next) => {
  try {
    const settings = await service.getSettings(req.user.id);
    ok(res, { settings });
  } catch (err) {
    next(err);
  }
};

const updateSettings = async (req, res, next) => {
  try {
    const settings = await service.updateSettings(req.user.id, req.body);
    ok(res, { settings });
  } catch (err) {
    next(err);
  }
};

const registerFcmToken = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return error(res, 'token is required.', 400, 'MISSING_FIELDS');
    const result = await service.registerFcmToken(req.user.id, token);
    ok(res, { result });
  } catch (err) {
    next(err);
  }
};

module.exports = { getSettings, updateSettings, registerFcmToken };
