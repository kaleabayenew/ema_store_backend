const { Router } = require('express');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../../core/config');
const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');
const ctrl = require('./agent_auth.controller');
const { ensureAgentAuthSchema } = require('./agent_auth.service');

const router = Router();

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);

/** Bearer agent token → loads the agent and attaches req.agent. */
const requireAgent = async (req, _res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) throw new AppError('Agent token required.', 401, 'AGENT_TOKEN_REQUIRED');
    const decoded = jwt.verify(token, jwtSecret);
    if (decoded.type !== 'AGENT_AUTH' || !decoded.sub) {
      throw new AppError('Invalid agent token.', 401, 'AGENT_TOKEN_INVALID');
    }
    await ensureAgentAuthSchema();
    const { rows } = await pool.query(
      `SELECT id, agent_code, full_name, phone, is_active FROM delivery_agents WHERE id = $1`,
      [decoded.sub],
    );
    const agent = rows[0];
    if (!agent || agent.is_active === false) {
      throw new AppError('Agent account not found or inactive.', 401, 'AGENT_NOT_FOUND');
    }
    req.agent = agent;
    next();
  } catch (err) {
    next(err);
  }
};

router.get('/me', requireAgent, ctrl.me);
router.post('/fcm-token', requireAgent, ctrl.updateFcmToken);
router.delete('/fcm-token', requireAgent, ctrl.clearFcmToken);

module.exports = router;
