const { ok, error } = require('../../core/utils/response');
const { AppError } = require('../../core/errors/app_error');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ── GET /api/v1/admin/partners
// Query: ?search=&status=&page=&limit=
const getAllPartners = async (req, res, next) => {
  try {
    const { search, status } = req.query;
    const limit  = parseInt(req.query.limit) || 15;
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * limit;

    const params = [];
    let where = ' WHERE 1=1';
    let idx = 1;

    if (search) {
      where += ` AND (pp.business_name ILIKE $${idx} OR pp.owner_name ILIKE $${idx} OR u.phone ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    if (status) {
      // APPROVED = verified, PENDING = active but not verified, SUSPENDED = not active
      if (status === 'APPROVED') {
        where += ` AND pp.is_verified = true`;
      } else if (status === 'PENDING') {
        where += ` AND COALESCE(pp.is_verified, false) = false AND COALESCE(pp.is_active, true) = true`;
      } else if (status === 'SUSPENDED') {
        where += ` AND pp.is_active = false`;
      }
    }

    // Aggregates + total
    const aggRes = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE pp.is_verified = true)::int AS approved,
         COUNT(*) FILTER (WHERE COALESCE(pp.is_verified, false) = false AND COALESCE(pp.is_active, true) = true)::int AS pending,
         COALESCE(AVG(pp.rating_avg), 0)::float AS avg_rating
       FROM partner_profile pp
       LEFT JOIN users u ON u.id = pp.user_id
       ${where}`,
      params,
    );
    const total     = aggRes.rows[0]?.total ?? 0;
    const approved  = aggRes.rows[0]?.approved ?? 0;
    const pending   = aggRes.rows[0]?.pending ?? 0;
    const avgRating = parseFloat(aggRes.rows[0]?.avg_rating ?? 0) || 0;

    // Page query
    const pageParams = [...params, limit, offset];
    const { rows } = await pool.query(
      `SELECT
        pp.id,
        pp.business_name as shop,
        pp.owner_name as owner,
        pp.city as sub_city,
        pp.rating_avg as rating,
        pp.rating_count,
        pp.total_orders as products,
        pp.total_sales as revenue,
        pp.is_verified,
        pp.is_active,
        pp.logo_url,
        pp.description,
        pp.address,
        pp.email as partner_email,
        pp.created_at,
        u.phone,
        u.email
      FROM partner_profile pp
      LEFT JOIN users u ON u.id = pp.user_id
      ${where}
      ORDER BY pp.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}`,
      pageParams,
    );

    const partners = rows.map(p => ({
      id: p.id,
      shop: p.shop,
      owner: p.owner,
      subCity: p.sub_city ?? '—',
      products: p.products || 0,
      revenue: p.revenue ? `ETB ${(Number(p.revenue) / 100).toLocaleString('en-ET')}` : 'ETB 0',
      rating: Number(p.rating) || 0,
      reviewCount: p.rating_count || 0,
      logoUrl: p.logo_url || null,
      description: p.description || null,
      address: p.address || null,
      partnerEmail: p.partner_email || null,
      createdAt: p.created_at,
      phone: p.phone,
      email: p.email,
      status: p.is_verified ? 'APPROVED' : (p.is_active === false ? 'SUSPENDED' : 'PENDING'),
    }));

    ok(res, {
      partners,
      count: partners.length,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      approved,
      pending,
      avgRating: parseFloat(avgRating.toFixed(1)),
    });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/admin/partners/:id
const getPartnerById = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
        pp.*,
        u.phone, u.email, u.created_at as user_created_at
       FROM partner_profile pp
       LEFT JOIN users u ON u.id = pp.user_id
       WHERE pp.id = $1`,
      [req.params.id],
    );
    if (rows.length === 0) return next(new AppError('Partner not found', 404, 'NOT_FOUND'));
    const p = rows[0];
    ok(res, {
      partner: {
        id: p.id,
        shop: p.business_name,
        owner: p.owner_name,
        subCity: p.city,
        phone: p.phone,
        email: p.email,
        partnerEmail: p.email,
        description: p.description,
        address: p.address,
        logoUrl: p.logo_url,
        rating: Number(p.rating_avg) || 0,
        reviewCount: p.rating_count || 0,
        products: p.total_orders || 0,
        revenue: p.total_sales ? `ETB ${(Number(p.total_sales) / 100).toLocaleString('en-ET')}` : 'ETB 0',
        status: p.is_verified ? 'APPROVED' : (p.is_active === false ? 'SUSPENDED' : 'PENDING'),
        createdAt: p.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/v1/admin/partners/:id/status
// body: { status: 'APPROVED' | 'SUSPENDED' | 'PENDING' }
const updatePartnerStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['APPROVED', 'SUSPENDED', 'PENDING'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const isVerified = status === 'APPROVED';
    const isActive   = status !== 'SUSPENDED';

    const { rowCount } = await pool.query(
      `UPDATE partner_profile
         SET is_verified = $1, is_active = $2, updated_at = NOW()
       WHERE id = $3`,
      [isVerified, isActive, req.params.id],
    );
    if (rowCount === 0) return next(new AppError('Partner not found', 404, 'NOT_FOUND'));
    ok(res, { message: `Partner status updated to ${status}` });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAllPartners,
  getPartnerById,
  updatePartnerStatus,
};
