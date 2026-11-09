const service = require('./auth.service');
const { ok, created, error } = require('../../../core/utils/response');

const register = async (req, res, next) => {
  try {
    const { phone, ownerName, shopName, address, city } = req.body;
    if (!phone || !ownerName || !shopName) {
      return error(res, 'phone, ownerName and shopName are required.', 400, 'MISSING_FIELDS');
    }
    const result = await service.register(phone.trim(), ownerName, shopName, address, city);
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const verifyRegister = async (req, res, next) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return error(res, 'phone and otp are required.', 400, 'MISSING_FIELDS');
    }
    const result = await service.verifyRegister(phone.trim(), otp.trim());
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return error(res, 'phone is required.', 400, 'MISSING_FIELDS');
    }
    const result = await service.login(phone.trim());
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const verifyLogin = async (req, res, next) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return error(res, 'phone and otp are required.', 400, 'MISSING_FIELDS');
    }
    const result = await service.verifyLogin(phone.trim(), otp.trim());
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const resendOtp = async (req, res, next) => {
  try {
    const { phone, type } = req.body;
    if (!phone || !type) {
      return error(res, 'phone and type are required.', 400, 'MISSING_FIELDS');
    }
    const result = await service.resendOtp(phone.trim(), type);
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const getMe = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return error(res, 'Authentication required.', 401, 'UNAUTHORIZED');
    const partner = await service.getMe(userId);
    ok(res, { partner });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, verifyRegister, login, verifyLogin, resendOtp, getMe };
