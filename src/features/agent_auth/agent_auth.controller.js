const service = require('./agent_auth.service');
const { ok, created } = require('../../core/utils/response');

const register = async (req, res, next) => {
  try {
    const result = await service.register(req.body || {});
    created(res, result);
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const result = await service.login(req.body?.phone, req.body?.password);
    ok(res, result);
  } catch (err) {
    next(err);
  }
};

const me = async (req, res, next) => {
  try {
    const agent = await service.me(req.agent.id);
    ok(res, { agent });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, me };
