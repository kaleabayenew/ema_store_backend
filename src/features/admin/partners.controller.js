const { ok, error } = require('../../core/utils/response');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// GET /api/v1/admin/partners - Get all partners
const getAllPartners = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        pp.id,
        pp.business_name as shop,
        pp.owner_name as owner,
        pp.city as sub_city,
        pp.rating_avg as rating,
        pp.rating_count,
        pp.total_orders as products,
        pp.total_sales as revenue,
        pp.is_verified as is_verified,
        pp.is_active as is_active,
        u.phone,
        u.email
      FROM partner_profile pp
      LEFT JOIN users u ON u.id = pp.user_id
      ORDER BY pp.created_at DESC
    `);

    const partners = rows.map(p => ({
      id: p.id,
      shop: p.shop,
      owner: p.owner,
      subCity: p.sub_city,
      products: p.products || 0,
      revenue: p.revenue ? `ETB ${(p.revenue / 100).toLocaleString('en-ET')}` : 'ETB 0',
      rating: p.rating || 0,
      status: p.is_verified ? 'APPROVED' : (p.is_active ? 'PENDING' : 'SUSPENDED'),
      phone: p.phone,
      email: p.email,
    }));

    ok(res, { partners });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllPartners,
};
