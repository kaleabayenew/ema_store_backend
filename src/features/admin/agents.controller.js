const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { ok, created } = require('../../core/utils/response');
const { AppError } = require('../../core/errors/app_error');
const { pool } = require('../../core/config/database');
const { ensureOrderFlowSchema } = require('../orders/order_flow');
const { ensureAgentAuthSchema } = require('../agent_auth/agent_auth.service');

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
                                   AND o.status IN ('CONFIRMED','PROCESSING','PACKED','SHIPPED','IN_TRANSIT'))::int AS active_deliveries,
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

// ── GET /api/v1/admin/agents/:id
// Full rider profile for the admin "view details" dialog.
// NOTE: password_hash is intentionally never selected or returned.
const getAgent = async (req, res, next) => {
  try {
    await ensureAgentAuthSchema();
    const { rows } = await pool.query(
      `SELECT id, agent_code, full_name, phone, is_active, created_at,
              national_id, license_number, vehicle_type, plate_number,
              emergency_contact, emergency_national_id, approval_status,
              last_lat, last_lng, last_location_at
       FROM delivery_agents WHERE id = $1`,
      [req.params.id],
    );
    const a = rows[0];
    if (!a) throw new AppError('Agent not found.', 404, 'AGENT_NOT_FOUND');

    // Live delivery stats — same aggregates as listAgents.
    const { rows: statRows } = await pool.query(
      `SELECT COUNT(o.id) FILTER (WHERE o.delivered_at IS NOT NULL)::int AS completed_deliveries,
              COUNT(o.id) FILTER (WHERE o.delivered_at IS NULL
                                   AND o.status IN ('CONFIRMED','PROCESSING','PACKED','SHIPPED','IN_TRANSIT'))::int AS active_deliveries,
              COUNT(o.id) FILTER (WHERE o.delivered_at IS NOT NULL
                                   AND o.delivered_at::date = CURRENT_DATE)::int AS deliveries_today,
              MAX(o.delivered_at) AS last_delivery_at
       FROM orders o WHERE o.delivery_agent_id = $1`,
      [a.id],
    );
    const s = statRows[0] || {};
    const ONLINE_WINDOW_MS = 3 * 60 * 1000;
    const lastLocationAt = a.last_location_at ? new Date(a.last_location_at) : null;
    const isOnline =
      lastLocationAt !== null &&
      Date.now() - lastLocationAt.getTime() < ONLINE_WINDOW_MS;

    ok(res, {
      agent: {
        id: a.id,
        agentCode: a.agent_code,
        fullName: a.full_name,
        phone: a.phone || null,
        isActive: a.is_active !== false,
        createdAt: a.created_at,
        nationalId: a.national_id || null,
        licenseNumber: a.license_number || null,
        vehicleType: a.vehicle_type || null,
        plateNumber: a.plate_number || null,
        emergencyContact: a.emergency_contact || null,
        emergencyNationalId: a.emergency_national_id || null,
        approvalStatus: a.approval_status || 'APPROVED',
        isOnline,
        lastLat: a.last_lat,
        lastLng: a.last_lng,
        lastLocationAt: a.last_location_at,
        completedDeliveries: s.completed_deliveries || 0,
        activeDeliveries: s.active_deliveries || 0,
        deliveriesToday: s.deliveries_today || 0,
        lastDeliveryAt: s.last_delivery_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/admin/agents/:id/deliveries
// Lists a rider's live deliveries or completed/cancelled delivery history.
const getAgentDeliveries = async (req, res, next) => {
  try {
    await ensureOrderFlowSchema();
    const type = String(req.query.type || 'active').toLowerCase();
    if (!['active', 'history'].includes(type)) {
      throw new AppError('Delivery type must be active or history.', 400, 'INVALID_DELIVERY_TYPE');
    }

    const requestedPage = Number.parseInt(req.query.page, 10);
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const page = Math.max(1, Number.isInteger(requestedPage) ? requestedPage : 1);
    const limit = Math.min(100, Math.max(1, Number.isInteger(requestedLimit) ? requestedLimit : 10));
    const offset = (page - 1) * limit;
    const deliveryFilter = type === 'active'
      ? `o.delivered_at IS NULL
         AND o.status IN ('CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'IN_TRANSIT')`
      : `(o.delivered_at IS NOT NULL OR o.status IN ('DELIVERED', 'CANCELLED'))`;

    const { rows: agentRows } = await pool.query(
      'SELECT id, agent_code, full_name FROM delivery_agents WHERE id = $1',
      [req.params.id],
    );
    const agent = agentRows[0];
    if (!agent) throw new AppError('Agent not found.', 404, 'AGENT_NOT_FOUND');

    const [countResult, deliveriesResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM orders o
         WHERE o.delivery_agent_id = $1 AND ${deliveryFilter}`,
        [agent.id],
      ),
      pool.query(
        `SELECT o.id, o.delivery_code, o.status, o.total_amount,
                o.shipping_address, o.payment_status, o.created_at,
                o.delivered_at,
                COALESCE(NULLIF(cu.full_name, ''), NULLIF(u.full_name, ''), u.phone, 'Customer') AS customer_name,
                COUNT(oi.id)::int AS item_count
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN customer_user cu ON cu.user_id = o.user_id
         LEFT JOIN order_items oi ON oi.order_id = o.id
         WHERE o.delivery_agent_id = $1 AND ${deliveryFilter}
         GROUP BY o.id, cu.full_name, u.full_name, u.phone
         ORDER BY COALESCE(o.delivered_at, o.updated_at, o.created_at) DESC
         LIMIT $2 OFFSET $3`,
        [agent.id, limit, offset],
      ),
    ]);

    const total = countResult.rows[0]?.total ?? 0;
    ok(res, {
      agent: { id: agent.id, agentCode: agent.agent_code, fullName: agent.full_name },
      type,
      deliveries: deliveriesResult.rows.map((row) => ({
        id: row.id,
        orderNumber: row.delivery_code || String(row.id).slice(0, 8).toUpperCase(),
        status: row.status,
        totalAmount: Number(row.total_amount) || 0,
        shippingAddress: row.shipping_address || '—',
        paymentStatus: row.payment_status || 'PENDING',
        customerName: row.customer_name || 'Customer',
        itemCount: Number(row.item_count) || 0,
        createdAt: row.created_at,
        deliveredAt: row.delivered_at,
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/admin/agents/:id/reset-password
// Sets a new password for the rider. If the body has no password, a
// temporary one is generated and returned ONCE — it is never retrievable
// afterwards because only the bcrypt hash is stored.
const resetAgentPassword = async (req, res, next) => {
  try {
    await ensureAgentAuthSchema();
    const { rows } = await pool.query(
      `SELECT id, agent_code, full_name FROM delivery_agents WHERE id = $1`,
      [req.params.id],
    );
    const agent = rows[0];
    if (!agent) throw new AppError('Agent not found.', 404, 'AGENT_NOT_FOUND');

    let password = String(req.body?.password || '').trim();
    if (password) {
      if (password.length < 6) {
        throw new AppError('Password must be at least 6 characters.', 400, 'PASSWORD_TOO_SHORT');
      }
    } else {
      // Readable temporary password: rider can change it after first login.
      password = `Rdr-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE delivery_agents SET password_hash = $2 WHERE id = $1`,
      [agent.id, hash],
    );

    ok(res, {
      agent: { id: agent.id, agentCode: agent.agent_code, fullName: agent.full_name },
      temporaryPassword: password,
    });
  } catch (err) {
    next(err);
  }
};

// ── Rider profile change requests ────────────────────────────────────────────

const agentAuthService = require('../agent_auth/agent_auth.service');

// GET /api/v1/admin/agents/profile-requests?status=PENDING
const listProfileRequests = async (req, res, next) => {
  try {
    const requests = await agentAuthService.listProfileRequests({
      status: req.query.status || 'PENDING',
      limit: req.query.limit,
    });
    ok(res, { requests });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/admin/agents/profile-requests/:id/review  { approve, note? }
const reviewProfileRequest = async (req, res, next) => {
  try {
    const result = await agentAuthService.reviewProfileRequest(
      req.params.id,
      { approve: req.body?.approve === true, note: req.body?.note },
    );
    ok(res, { request: result });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listAgents,
  createAgent,
  setAgentStatus,
  getAgent,
  getAgentDeliveries,
  resetAgentPassword,
  listProfileRequests,
  reviewProfileRequest,
};
