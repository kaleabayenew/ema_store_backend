const { pool } = require('../../core/config/database');
const { ok } = require('../../core/utils/response');
const { AppError } = require('../../core/errors/app_error');

// Money the platform keeps per order: customer service fee + partner
// commission + rider commission. Partner/rider revenue is computed net of
// their commission so the platform side and the party side always reconcile.
const PLATFORM_ROLES = ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'MANAGEMENT', 'MANAGER'];

/** GET /api/v1/admin/balance — platform balance summary + ledger entries. */
const getBalance = async (req, res, next) => {
  try {
    const role = String(req.user?.adminRole || req.user?.role || '').toUpperCase();
    if (!PLATFORM_ROLES.includes(role)) {
      throw new AppError('You do not have access to the balance page.', 403, 'FORBIDDEN');
    }

    const IN_FLIGHT = `('CONFIRMED','PROCESSING','PACKED','SHIPPED')`;
    const [summaryRes, entriesRes, pendingRes, inflightRes, paidRes] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(o.service_fee_cents), 0)::bigint AS service_charges,
          COALESCE(SUM(o.partner_commission_cents), 0)::bigint AS partner_commissions,
          COALESCE(SUM(o.rider_commission_cents), 0)::bigint AS rider_commissions,
          COALESCE(SUM(o.delivery_fee_cents - COALESCE(o.rider_commission_cents, 0)) FILTER (
            WHERE o.status IN ('DELIVERED', 'COMPLETED')), 0)::bigint AS rider_earnings,
          COALESCE((
            SELECT SUM(COALESCE(oi.price_at_order, 0) * oi.quantity - COALESCE(oi.commission_cents, 0))
            FROM order_items oi
            JOIN orders od ON od.id = oi.order_id
            WHERE od.status IN ('DELIVERED', 'COMPLETED')
          ), 0)::bigint AS partner_revenue,
          COALESCE((
            SELECT SUM(amount) * 100 FROM wallet_transactions
            WHERE type = 'ORDER_PAYOUT' AND status = 'COMPLETED'
          ), 0)::bigint AS total_paid_out
        FROM orders o
        WHERE o.status NOT IN ('CANCELLED', 'REFUNDED')
      `),
      // Ledger entries: one row per delivered order showing the platform cut.
      pool.query(`
        SELECT o.id, o.delivery_code, o.created_at, o.delivered_at,
               o.service_fee_cents, o.partner_commission_cents, o.rider_commission_cents,
               u.full_name AS customer_name
        FROM orders o
        JOIN users u ON u.id = o.user_id
        WHERE o.status IN ('DELIVERED', 'COMPLETED')
          AND (COALESCE(o.service_fee_cents, 0) + COALESCE(o.partner_commission_cents, 0)
               + COALESCE(o.rider_commission_cents, 0)) > 0
        ORDER BY COALESCE(o.delivered_at, o.created_at) DESC
        LIMIT 100
      `),
      pool.query(`
        SELECT COALESCE(SUM(ABS(amount)) * 100, 0)::bigint AS pending
        FROM wallet_transactions
        WHERE type IN ('PAYOUT_REQUEST','TRANSFER_REQUEST') AND status = 'PENDING'
      `),
      // In-flight orders: money earned/held but not yet settled.
      pool.query(`
        SELECT
          COALESCE((
            SELECT SUM(oi.price_at_order * oi.quantity - COALESCE(oi.commission_cents, 0))
            FROM order_items oi
            JOIN orders od ON od.id = oi.order_id
            WHERE od.status IN ${IN_FLIGHT}
          ), 0)::bigint AS partner_gross,
          COALESCE(SUM(CASE WHEN COALESCE(o.delivery_fee_cents, 0) > 0
            THEN GREATEST(o.delivery_fee_cents - COALESCE(o.rider_commission_cents, 0), 0)
            ELSE ROUND(COALESCE(o.total_cents, ROUND(o.total_amount * 100)::int) * 0.10) END), 0)::bigint AS rider_gross,
          COALESCE(SUM(COALESCE(o.service_fee_cents, 0)
                    + COALESCE(o.partner_commission_cents, 0)
                    + COALESCE(o.rider_commission_cents, 0)), 0)::bigint AS platform_pending,
          COALESCE(SUM(o.total_cents) FILTER (WHERE o.payment_status = 'PAID'), 0)::bigint AS escrow_held
        FROM orders o
        WHERE o.status IN ${IN_FLIGHT}
      `),
      // Already-disbursed milestone payouts on in-flight orders (e.g. the
      // 50% partner deposit at pickup) so pending = earned − paid.
      pool.query(`
        SELECT op.payee_type, COALESCE(SUM(op.paid_cents), 0)::bigint AS paid
        FROM order_payouts op
        JOIN orders o ON o.id = op.order_id
        WHERE o.status IN ${IN_FLIGHT}
        GROUP BY op.payee_type
      `),
    ]);

    const s = summaryRes.rows[0] || {};
    const inf = inflightRes.rows[0] || {};
    const paidByType = {};
    for (const r of paidRes.rows) paidByType[r.payee_type] = Number(r.paid || 0);
    const pendingPartnerCents = Math.max(
      0, Number(inf.partner_gross || 0) - (paidByType.PARTNER || 0),
    );
    const pendingRiderCents = Math.max(
      0, Number(inf.rider_gross || 0) - (paidByType.RIDER || 0),
    );
    const serviceCharges = Number(s.service_charges || 0);
    const partnerCommissions = Number(s.partner_commissions || 0);
    const riderCommissions = Number(s.rider_commissions || 0);

    const entries = [];
    for (const r of entriesRes.rows) {
      const code = r.delivery_code || String(r.id).slice(0, 8).toUpperCase();
      const who = r.customer_name ? ` · ${r.customer_name}` : '';
      if (Number(r.service_fee_cents) > 0) {
        entries.push({
          id: `${r.id}-service`, label: `Service fee — order ${code}${who}`,
          party: 'Customer', amount: Number(r.service_fee_cents), type: 'credit',
          createdAt: r.delivered_at || r.created_at,
        });
      }
      if (Number(r.partner_commission_cents) > 0) {
        entries.push({
          id: `${r.id}-partner`, label: `Partner commission — order ${code}${who}`,
          party: 'Partner', amount: Number(r.partner_commission_cents), type: 'credit',
          createdAt: r.delivered_at || r.created_at,
        });
      }
      if (Number(r.rider_commission_cents) > 0) {
        entries.push({
          id: `${r.id}-rider`, label: `Rider commission — order ${code}${who}`,
          party: 'Rider', amount: Number(r.rider_commission_cents), type: 'credit',
          createdAt: r.delivered_at || r.created_at,
        });
      }
    }
    entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    ok(res, {
      summary: {
        platformBalance: serviceCharges + partnerCommissions + riderCommissions,
        riderEarnings: Number(s.rider_earnings || 0),
        partnerRevenue: Number(s.partner_revenue || 0),
        pendingPayouts: Number(pendingRes.rows[0]?.pending ?? 0),
        serviceCharges,
        partnerCommissions,
        riderCommissions,
        totalPaidOutCents: Number(s.total_paid_out || 0),
        pendingPartnerCents,
        pendingRiderCents,
        platformPendingCents: Number(inf.platform_pending || 0),
        escrowHeldCents: Number(inf.escrow_held || 0),
      },
      entries: entries.slice(0, 100),
    });
  } catch (err) {
    next(err);
  }
};

const IN_FLIGHT = `('CONFIRMED','PROCESSING','PACKED','SHIPPED')`;

// Per-person breakdowns for each Balance card. Every query returns
// name/detail/amount_cents (+ optional orders count) and a total_count
// window column for pagination.
const BREAKDOWNS = {
  // Platform balance = service fee + partner commission + rider commission
  platform: `
    SELECT u.full_name AS name, 'Customer' AS detail,
           SUM(COALESCE(o.service_fee_cents,0) + COALESCE(o.partner_commission_cents,0)
               + COALESCE(o.rider_commission_cents,0))::bigint AS amount_cents,
           COUNT(*)::int AS orders,
           COUNT(*) OVER()::int AS total_count
    FROM orders o JOIN users u ON u.id = o.user_id
    WHERE o.status IN ('DELIVERED','COMPLETED')
      AND (COALESCE(o.service_fee_cents,0) + COALESCE(o.partner_commission_cents,0)
           + COALESCE(o.rider_commission_cents,0)) > 0
    GROUP BY u.id, u.full_name
    ORDER BY amount_cents DESC`,

  // Rider earnings (net of rider commission) per delivery agent
  rider: `
    SELECT COALESCE(a.full_name, 'Unassigned rider') AS name,
           COALESCE(a.agent_code, '—') AS detail,
           SUM(o.delivery_fee_cents - COALESCE(o.rider_commission_cents,0))::bigint AS amount_cents,
           COUNT(*)::int AS orders,
           COUNT(*) OVER()::int AS total_count
    FROM orders o
    LEFT JOIN delivery_agents a ON a.id = o.delivery_agent_id
    WHERE o.status IN ('DELIVERED','COMPLETED')
      AND COALESCE(o.delivery_fee_cents,0) > 0
    GROUP BY a.id, a.full_name, a.agent_code
    HAVING SUM(o.delivery_fee_cents - COALESCE(o.rider_commission_cents,0)) <> 0
    ORDER BY amount_cents DESC`,

  // Partner revenue (net of commission) per shop/partner
  partner: `
    SELECT COALESCE(pp.shop_name, pu.full_name, 'Partner') AS name,
           COALESCE(pu.full_name, '') AS detail,
           SUM(oi.price_at_order * oi.quantity - COALESCE(oi.commission_cents,0))::bigint AS amount_cents,
           COUNT(DISTINCT o.id)::int AS orders,
           COUNT(*) OVER()::int AS total_count
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id AND o.status IN ('DELIVERED','COMPLETED')
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN users pu ON pu.id = p.partner_id
    LEFT JOIN partner_profile pp ON pp.user_id = p.partner_id
    GROUP BY p.partner_id, pp.shop_name, pu.full_name
    ORDER BY amount_cents DESC`,

  // Pending wallet payout/transfer requests per user
  pendingPayouts: `
    SELECT COALESCE(NULLIF(u.full_name,''), u.phone, 'User') AS name,
           COALESCE(u.phone, '') AS detail,
           SUM(ABS(wt.amount) * 100)::bigint AS amount_cents,
           COUNT(*)::int AS orders,
           COUNT(*) OVER()::int AS total_count
    FROM wallet_transactions wt
    JOIN users u ON u.id = wt.user_id
    WHERE wt.type IN ('PAYOUT_REQUEST','TRANSFER_REQUEST') AND wt.status = 'PENDING'
    GROUP BY u.id, u.full_name, u.phone
    ORDER BY amount_cents DESC`,

  // Service charges per customer (delivered orders)
  service: `
    SELECT u.full_name AS name, 'Customer' AS detail,
           SUM(COALESCE(o.service_fee_cents,0))::bigint AS amount_cents,
           COUNT(*)::int AS orders,
           COUNT(*) OVER()::int AS total_count
    FROM orders o JOIN users u ON u.id = o.user_id
    WHERE o.status IN ('DELIVERED','COMPLETED') AND COALESCE(o.service_fee_cents,0) > 0
    GROUP BY u.id, u.full_name
    ORDER BY amount_cents DESC`,

  // Total paid out per payee (completed ORDER_PAYOUT wallet credits)
  paidOut: `
    SELECT COALESCE(NULLIF(u.full_name,''), u.phone, 'User') AS name,
           COALESCE(u.phone, '') AS detail,
           SUM(wt.amount * 100)::bigint AS amount_cents,
           COUNT(*)::int AS orders,
           COUNT(*) OVER()::int AS total_count
    FROM wallet_transactions wt
    JOIN users u ON u.id = wt.user_id
    WHERE wt.type = 'ORDER_PAYOUT' AND wt.status = 'COMPLETED'
    GROUP BY u.id, u.full_name, u.phone
    ORDER BY amount_cents DESC`,

  // Pending partner payouts on in-flight orders (earned − already paid)
  pendingPartner: `
    WITH earned AS (
      SELECT p.partner_id,
             SUM(oi.price_at_order * oi.quantity - COALESCE(oi.commission_cents,0))::bigint AS earned,
             COUNT(DISTINCT o.id)::int AS orders
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id AND o.status IN ${IN_FLIGHT}
      JOIN products p ON p.id = oi.product_id
      GROUP BY p.partner_id
    ), paid AS (
      SELECT op.payee_id, SUM(op.paid_cents)::bigint AS paid
      FROM order_payouts op
      JOIN orders o ON o.id = op.order_id AND o.status IN ${IN_FLIGHT}
      WHERE op.payee_type = 'PARTNER'
      GROUP BY op.payee_id
    )
    SELECT COALESCE(pp.shop_name, pu.full_name, 'Partner') AS name,
           COALESCE(pu.full_name, '') AS detail,
           GREATEST(e.earned - COALESCE(p.paid,0), 0)::bigint AS amount_cents,
           e.orders,
           COUNT(*) OVER()::int AS total_count
    FROM earned e
    LEFT JOIN paid p ON p.payee_id = e.partner_id
    LEFT JOIN users pu ON pu.id = e.partner_id
    LEFT JOIN partner_profile pp ON pp.user_id = e.partner_id
    WHERE GREATEST(e.earned - COALESCE(p.paid,0), 0) > 0
    ORDER BY amount_cents DESC`,

  // Pending rider payouts on in-flight orders (earned − already paid)
  pendingRider: `
    WITH earned AS (
      SELECT o.delivery_agent_id AS agent_id,
             SUM(CASE WHEN COALESCE(o.delivery_fee_cents,0) > 0
                      THEN GREATEST(o.delivery_fee_cents - COALESCE(o.rider_commission_cents,0), 0)
                      ELSE ROUND(COALESCE(o.total_cents, ROUND(o.total_amount * 100)::int) * 0.10) END)::bigint AS earned,
             COUNT(*)::int AS orders
      FROM orders o
      WHERE o.status IN ${IN_FLIGHT}
      GROUP BY o.delivery_agent_id
    ), paid AS (
      SELECT op.payee_id, SUM(op.paid_cents)::bigint AS paid
      FROM order_payouts op
      JOIN orders o ON o.id = op.order_id AND o.status IN ${IN_FLIGHT}
      WHERE op.payee_type = 'RIDER'
      GROUP BY op.payee_id
    )
    SELECT COALESCE(a.full_name, 'Unassigned rider') AS name,
           COALESCE(a.agent_code, '—') AS detail,
           GREATEST(e.earned - COALESCE(p.paid,0), 0)::bigint AS amount_cents,
           e.orders,
           COUNT(*) OVER()::int AS total_count
    FROM earned e
    LEFT JOIN paid p ON p.payee_id = e.agent_id
    LEFT JOIN delivery_agents a ON a.id = e.agent_id
    WHERE GREATEST(e.earned - COALESCE(p.paid,0), 0) > 0
    ORDER BY amount_cents DESC`,

  // Platform cut pending on in-flight orders, per customer
  platformPending: `
    SELECT u.full_name AS name, 'Customer' AS detail,
           SUM(COALESCE(o.service_fee_cents,0) + COALESCE(o.partner_commission_cents,0)
               + COALESCE(o.rider_commission_cents,0))::bigint AS amount_cents,
           COUNT(*)::int AS orders,
           COUNT(*) OVER()::int AS total_count
    FROM orders o JOIN users u ON u.id = o.user_id
    WHERE o.status IN ${IN_FLIGHT}
      AND (COALESCE(o.service_fee_cents,0) + COALESCE(o.partner_commission_cents,0)
           + COALESCE(o.rider_commission_cents,0)) > 0
    GROUP BY u.id, u.full_name
    ORDER BY amount_cents DESC`,

  // Money held in escrow per customer (paid, undelivered orders)
  escrow: `
    SELECT u.full_name AS name, 'Customer' AS detail,
           SUM(o.total_cents)::bigint AS amount_cents,
           COUNT(*)::int AS orders,
           COUNT(*) OVER()::int AS total_count
    FROM orders o JOIN users u ON u.id = o.user_id
    WHERE o.status IN ${IN_FLIGHT} AND o.payment_status = 'PAID'
    GROUP BY u.id, u.full_name
    ORDER BY amount_cents DESC`,
};

/** GET /api/v1/admin/balance/breakdown?card=<key>&page=<n>&limit=<m> */
const getBalanceBreakdown = async (req, res, next) => {
  try {
    const role = String(req.user?.adminRole || req.user?.role || '').toUpperCase();
    if (!PLATFORM_ROLES.includes(role)) {
      throw new AppError('You do not have access to the balance page.', 403, 'FORBIDDEN');
    }
    const card = String(req.query.card || '');
    const sql = BREAKDOWNS[card];
    if (!sql) {
      throw new AppError('Unknown balance card.', 400, 'BAD_REQUEST');
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 8));
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(`${sql} LIMIT $1 OFFSET $2`, [limit, offset]);
    const total = rows.length ? Number(rows[0].total_count || 0) : 0;

    ok(res, {
      card,
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      rows: rows.map((r) => ({
        name: r.name,
        detail: r.detail || '',
        amountCents: Number(r.amount_cents || 0),
        orders: Number(r.orders || 0),
      })),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getBalance, getBalanceBreakdown };
