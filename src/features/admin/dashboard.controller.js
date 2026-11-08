const { ok } = require('../../core/utils/response');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getDashboard(req, res, next) {
  try {
    // ── KPI summary ───────────────────────────────────────────────────────────
    const kpiRes = await pool.query(`
      SELECT
        COALESCE(SUM(total_amount), 0)::numeric                                AS revenue_total,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN total_amount END), 0)::numeric AS revenue_30d,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days' THEN total_amount END), 0)::numeric AS revenue_prev_30d,
        COUNT(*)::int                                                          AS orders_total,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::int AS orders_30d,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days' THEN 1 END)::int AS orders_prev_30d
      FROM orders
    `);
    const kpi = kpiRes.rows[0];

    const partnerRes = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN is_active = true THEN 1 END)::int AS active
      FROM partner_profile
    `);
    const partners = partnerRes.rows[0];

    const customerRes = await pool.query(`
      SELECT COUNT(*)::int AS total FROM users WHERE role = 'CUSTOMER'
    `);
    const customers = customerRes.rows[0];

    const refundRes = await pool.query(`
      SELECT COALESCE(SUM(total_amount), 0)::numeric AS refunds
      FROM orders WHERE status = 'REFUNDED' AND created_at >= NOW() - INTERVAL '30 days'
    `);
    const refunds = refundRes.rows[0];

    // ── Monthly sales chart (last 12 months) ──────────────────────────────────
    const salesRes = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') AS month,
        DATE_TRUNC('month', created_at) AS month_date,
        COALESCE(SUM(total_amount), 0)::numeric AS revenue,
        COUNT(*)::int AS order_count
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month_date ASC
    `);

    // ── Order status mix ──────────────────────────────────────────────────────
    const statusRes = await pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM orders
      GROUP BY status
      ORDER BY count DESC
    `);

    // ── Orders by city (from shipping_address pattern) ────────────────────────
    // Use a simple word-frequency approach on shipping_address
    const cityRes = await pool.query(`
      SELECT
        shipping_address AS city,
        COUNT(*)::int AS orders
      FROM orders
      WHERE shipping_address IS NOT NULL AND shipping_address != ''
      GROUP BY shipping_address
      ORDER BY orders DESC
      LIMIT 6
    `);

    // ── Top products ──────────────────────────────────────────────────────────
    const topProductsRes = await pool.query(`
      SELECT p.name_en AS name, p.sold_count AS sold
      FROM products p
      WHERE p.status = 'APPROVED'
      ORDER BY p.sold_count DESC
      LIMIT 5
    `);

    // ── Top partners ──────────────────────────────────────────────────────────
    const topPartnersRes = await pool.query(`
      SELECT pp.business_name AS name, pp.total_sales AS sales
      FROM partner_profile pp
      ORDER BY pp.total_sales DESC NULLS LAST
      LIMIT 5
    `);

    // ── Recent orders ─────────────────────────────────────────────────────────
    const recentOrdersRes = await pool.query(`
      SELECT
        o.id,
        o.status,
        o.total_amount,
        o.created_at,
        COALESCE(cu.full_name, u.phone) AS customer_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN customer_user cu ON cu.user_id = o.user_id
      ORDER BY o.created_at DESC
      LIMIT 5
    `);

    // ── Open support tickets ──────────────────────────────────────────────────
    const ticketsRes = await pool.query(`
      SELECT COUNT(*)::int AS open_tickets
      FROM support_tickets
      WHERE status IN ('OPEN', 'IN_PROGRESS')
    `).catch(() => ({ rows: [{ open_tickets: 0 }] }));

    // ── New customers (last 30 days) ──────────────────────────────────────────
    const newCustRes = await pool.query(`
      SELECT COUNT(*)::int AS new_customers
      FROM users
      WHERE role = 'CUSTOMER' AND created_at >= NOW() - INTERVAL '30 days'
    `);

    // ── Helper: pct change ────────────────────────────────────────────────────
    const pct = (curr, prev) => {
      if (!prev || prev === 0) return curr > 0 ? '+100%' : '0%';
      const change = ((curr - prev) / prev) * 100;
      return (change >= 0 ? '+' : '') + change.toFixed(1) + '%';
    };

    ok(res, {
      kpi: {
        revenue:      parseFloat(kpi.revenue_30d) || 0,
        revenueDelta: pct(parseFloat(kpi.revenue_30d), parseFloat(kpi.revenue_prev_30d)),
        orders:       kpi.orders_30d,
        ordersDelta:  pct(kpi.orders_30d, kpi.orders_prev_30d),
        partners:     partners.active,
        customers:    customers.total,
        refunds:      parseFloat(refunds.refunds) || 0,
        openTickets:  ticketsRes.rows[0]?.open_tickets ?? 0,
        newCustomers: newCustRes.rows[0]?.new_customers ?? 0,
      },
      salesChart:   salesRes.rows.map((r) => ({
        name:    r.month,
        revenue: parseFloat(r.revenue) || 0,
        orders:  r.order_count,
      })),
      orderMix:     statusRes.rows.map((r) => ({ name: r.status, value: r.count })),
      cityData:     cityRes.rows.map((r) => ({ city: r.city, orders: r.orders })),
      topProducts:  topProductsRes.rows.map((r) => ({ name: r.name, sold: r.sold || 0 })),
      topPartners:  topPartnersRes.rows.map((r) => ({ name: r.name, sales: parseFloat(r.sales) || 0 })),
      recentOrders: recentOrdersRes.rows.map((r) => ({
        id:           r.id,
        status:       r.status,
        totalAmount:  parseFloat(r.total_amount) || 0,
        customerName: r.customer_name ?? 'Unknown',
        createdAt:    r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboard };
