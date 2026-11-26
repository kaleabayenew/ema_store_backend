const { ok } = require('../../core/utils/response');
const { pool } = require('../../core/config/database');
const { ensureOrderFlowSchema } = require('../orders/order_flow');

async function getDashboard(req, res, next) {
  try {
    await ensureOrderFlowSchema();

    // ── KPI summary ───────────────────────────────────────────────────────────
    const kpiRes = await pool.query(`
      SELECT
        COALESCE(SUM(total_amount) FILTER (
          WHERE payment_status = 'PAID'
            AND status <> 'REFUNDED'
            AND created_at >= NOW() - INTERVAL '30 days'
        ), 0)::numeric AS revenue_30d,
        COALESCE(SUM(total_amount) FILTER (
          WHERE payment_status = 'PAID'
            AND status <> 'REFUNDED'
            AND created_at >= NOW() - INTERVAL '60 days'
            AND created_at < NOW() - INTERVAL '30 days'
        ), 0)::numeric AS revenue_prev_30d,
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
      WITH months AS (
        SELECT generate_series(
          DATE_TRUNC('month', NOW()::timestamp) - INTERVAL '11 months',
          DATE_TRUNC('month', NOW()::timestamp),
          INTERVAL '1 month'
        ) AS month_date
      ),
      monthly_orders AS (
        SELECT
          DATE_TRUNC('month', created_at) AS month_date,
          COALESCE(SUM(total_amount) FILTER (
            WHERE payment_status = 'PAID' AND status <> 'REFUNDED'
          ), 0)::numeric AS revenue,
          COUNT(*)::int AS order_count
        FROM orders
        WHERE created_at >= DATE_TRUNC('month', NOW()::timestamp) - INTERVAL '11 months'
          AND created_at < DATE_TRUNC('month', NOW()::timestamp) + INTERVAL '1 month'
        GROUP BY DATE_TRUNC('month', created_at)
      )
      SELECT
        TO_CHAR(months.month_date, 'Mon') AS month,
        months.month_date,
        COALESCE(monthly_orders.revenue, 0)::numeric AS revenue,
        COALESCE(monthly_orders.order_count, 0)::int AS order_count
      FROM months
      LEFT JOIN monthly_orders USING (month_date)
      ORDER BY months.month_date ASC
    `);

    // ── Order status mix ──────────────────────────────────────────────────────
    const statusRes = await pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM orders
      GROUP BY status
      ORDER BY count DESC
    `);

    // Addresses use "area, city (Pin: ...)" format; group by their first segment.
    const cityRes = await pool.query(`
      SELECT
        NULLIF(TRIM(SPLIT_PART(shipping_address, ',', 1)), '') AS area,
        COUNT(*)::int AS orders
      FROM orders
      WHERE shipping_address IS NOT NULL AND shipping_address != ''
      GROUP BY NULLIF(TRIM(SPLIT_PART(shipping_address, ',', 1)), '')
      ORDER BY orders DESC
      LIMIT 6
    `);

    // ── Top products ──────────────────────────────────────────────────────────
    const topProductsRes = await pool.query(`
      SELECT COALESCE(NULLIF(p.name_en, ''), p.name) AS name,
             SUM(oi.quantity)::int AS sold
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      WHERE o.payment_status = 'PAID' AND o.status <> 'REFUNDED'
      GROUP BY p.id, p.name_en, p.name
      ORDER BY sold DESC
      LIMIT 5
    `);

    // ── Top partners ──────────────────────────────────────────────────────────
    const topPartnersRes = await pool.query(`
      SELECT COALESCE(
               NULLIF(pp.business_name, ''),
               NULLIF(pp.shop_name, ''),
               pp.owner_name,
               'Partner'
             ) AS name,
             (SUM(oi.price_at_order * oi.quantity) / 100.0)::numeric AS sales
      FROM partner_profile pp
      JOIN products p ON p.partner_id = pp.user_id
      JOIN order_items oi ON oi.product_id = p.id
      JOIN orders o ON o.id = oi.order_id
      WHERE o.payment_status = 'PAID' AND o.status <> 'REFUNDED'
      GROUP BY pp.id, pp.business_name, pp.shop_name, pp.owner_name
      ORDER BY sales DESC
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
      cityData:     cityRes.rows.map((r) => ({ area: r.area || 'Unknown', orders: r.orders })),
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
