const { ok, created } = require('../../core/utils/response');
const { AppError } = require('../../core/errors/app_error');
const { pool } = require('../../core/config/database');
const { ensureOrderFlowSchema } = require('../orders/order_flow');

// ── GET /api/v1/admin/agents
// Lists delivery agents (ride riders) with live delivery stats.
const listAgents = async (req, res, next) => {
  try {
    await ensureOrderFlowSchema();
    const { search, status } = req.query;

    const params = [];
    let where = ' WHERE 1=1';
    let idx = 1;

    if (search) {
      where += ` AND (a.agent_code ILIKE $${idx} OR a.full_name ILIKE $${idx} OR a.phone ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    if (status === 'ACTIVE') {
      where += ' AND a.is_active = true';
    } else if (status === 'INACTIVE') {
      where += ' AND a.is_active = false';
    }

    const { rows } = await pool.query(
      `SELECT a.id, a.agent_code, a.full_name, a.phone, a.is_active, a.created_at,
              a.last_lat, a.last_lng, a.last_location_at,
              COUNT(o.id) FILTER (WHERE o.delivered_at IS NOT NULL)::int AS completed_deliveries,
              COUNT(o.id) FILTER (WHERE o.delivered_at IS NULL
                                   AND o.status IN ('CONFIRMED','PACKED','SHIPPED'))::int AS active_deliveries,
              COUNT(o.id) FILTER (WHERE o.delivered_at IS NOT NULL
                                   AND o.delivered_at::date = CURRENT_DATE)::int AS deliveries_today,
              MAX(o.delivered_at) AS last_delivery_at
       FROM delivery_agents a
       LEFT JOIN orders o ON o.delivery_agent_id = a.id
       ${where}
       GROUP BY a.id
       ORDER BY a.created_at DESC`,
      params,
    );

    const ONLINE_WINDOW_MS = 3 * 60 * 1000; // riders report GPS ~every 10 s
    const agents = rows.map((r) => {
      const lastLocationAt = r.last_location_at
        ? new Date(r.last_location_at)
        : null;
      const isOnline =
        lastLocationAt !== null &&
        Date.now() - lastLocationAt.getTime() < ONLINE_WINDOW_MS;
      return {
        id: r.id,
        agentCode: r.agent_code,
        fullName: r.full_name,
        phone: r.phone || null,
        isActive: r.is_active !== false,
        createdAt: r.created_at,
        completedDeliveries: r.completed_deliveries || 0,
        activeDeliveries: r.active_deliveries || 0,
        deliveriesToday: r.deliveries_today || 0,
        lastDeliveryAt: r.last_delivery_at,
        isOnline,
        lastLocationAt: r.last_location_at,
        lastLat: r.last_lat,
        lastLng: r.last_lng,
      };
    });

    ok(res, {
      agents,
      stats: {
        totalRiders: agents.filter((a) => a.isActive).length,
        activeRiders: agents.filter((a) => a.isActive && a.activeDeliveries > 0).length,
        onlineRiders: agents.filter((a) => a.isOnline).length,
        deliveriesToday: agents.reduce((sum, a) => sum + a.deliveriesToday, 0),
        completedDeliveries: agents.reduce((sum, a) => sum + a.completedDeliveries, 0),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/admin/agents
// Creates a delivery agent. The agent_code is what the rider types into
// the ride app (More → Agent code) and what partners scan at handover.
const createAgent = async (req, res, next) => {
  try {
    await ensureOrderFlowSchema();
    const agentCode = String(req.body?.agentCode || req.body?.agent_code || '')
      .trim()
      .toUpperCase()
      .slice(0, 40);
    const fullName = String(req.body?.fullName || req.body?.full_name || '').trim();
    const phone = String(req.body?.phone || '').trim() || null;

    if (!agentCode || !/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(agentCode)) {
      throw new AppError(
        'Agent code is required (3-40 chars: letters, numbers, - or _).',
        400,
        'INVALID_AGENT_CODE',
      );
    }
    if (!fullName) {
      throw new AppError('Full name is required.', 400, 'NAME_REQUIRED');
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO delivery_agents (agent_code, full_name, phone)
         VALUES ($1, $2, $3)
         RETURNING id, agent_code, full_name, phone, is_active, created_at`,
        [agentCode, fullName, phone],
      );
      const a = rows[0];
      created(res, {
        agent: {
          id: a.id,
          agentCode: a.agent_code,
          fullName: a.full_name,
          phone: a.phone,
          isActive: a.is_active !== false,
          createdAt: a.created_at,
        },
      });
    } catch (err) {
      if (err && err.code === '23505') {
        throw new AppError('An agent with this code already exists.', 409, 'AGENT_CODE_TAKEN');
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/v1/admin/agents/:id/status
// Body: { isActive: boolean } — activate/deactivate a rider.
const setAgentStatus = async (req, res, next) => {
  try {
    await ensureOrderFlowSchema();
    const isActive = req.body?.isActive === true || req.body?.is_active === true;
    const { rows } = await pool.query(
      `UPDATE delivery_agents SET is_active = $2 WHERE id = $1
       RETURNING id, agent_code, full_name, phone, is_active`,
      [req.params.id, isActive],
    );
    if (!rows[0]) throw new AppError('Agent not found.', 404, 'AGENT_NOT_FOUND');
    ok(res, { agent: rows[0] });
  } catch (err) {
    next(err);
  }
};

module.exports = { listAgents, createAgent, setAgentStatus };
