const { ok, error } = require('../../core/utils/response');
const { pool } = require('../../core/config/database');
const { sendMail } = require('../../core/services/mailer.service');

// GET /api/v1/admin/approvals — pending partners + pending products
const getApprovals = async (req, res, next) => {
  try {
    const partners = await pool.query(`
      SELECT pp.id, pp.user_id, pp.business_name, pp.shop_name, pp.owner_name,
             pp.phone, pp.email AS partner_email, pp.address, pp.city,
             pp.description, pp.logo_url, pp.rating_avg, pp.rating_count,
             pp.is_verified, pp.is_active, pp.created_at,
             u.full_name, u.email AS user_email, u.phone AS user_phone,
             (SELECT COUNT(*) FROM products p WHERE p.partner_id = pp.user_id) AS product_count
      FROM partner_profile pp
      JOIN users u ON u.id = pp.user_id
      WHERE pp.is_active = true AND pp.is_verified = false
      ORDER BY pp.created_at ASC
    `);

    const products = await pool.query(`
      SELECT p.id, p.name_en, p.price_cents, p.stock, p.status, p.category,
             p.image_url, p.created_at,
             pp.business_name AS partner_name, pp.owner_name AS partner_owner,
             u.email AS partner_email
      FROM products p
      LEFT JOIN partner_profile pp ON pp.user_id = p.partner_id
      LEFT JOIN users u ON u.id = p.partner_id
      WHERE p.status = 'PENDING'
      ORDER BY p.created_at ASC
    `);

    ok(res, {
      partners: partners.rows.map(mapPartner),
      products: products.rows.map(mapProduct),
    });
  } catch (err) {
    next(err);
  }
};

function mapPartner(r) {
  return {
    id: r.id,
    userId: r.user_id,
    type: 'PARTNER',
    name: r.business_name || r.shop_name || r.owner_name || 'Partner',
    submittedBy: r.owner_name || r.full_name || r.user_email || '—',
    submittedAt: r.created_at,
    email: r.partner_email || r.user_email || null,
    phone: r.phone || r.user_phone || null,
    city: r.city || null,
    address: r.address || null,
    description: r.description || null,
    logoUrl: r.logo_url || null,
    rating: Number(r.rating_avg) || 0,
    reviewCount: r.rating_count || 0,
    productCount: Number(r.product_count) || 0,
    detail: {
      businessName: r.business_name || r.shop_name || null,
      ownerName: r.owner_name || r.full_name || null,
      accountEmail: r.user_email || null,
      partnerEmail: r.partner_email || null,
      phone: r.phone || r.user_phone || null,
      city: r.city || null,
      address: r.address || null,
      description: r.description || null,
      rating: Number(r.rating_avg) || 0,
      reviewCount: r.rating_count || 0,
      productCount: Number(r.product_count) || 0,
      submittedAt: r.created_at,
    },
  };
}

function mapProduct(r) {
  return {
    id: r.id,
    userId: null,
    type: 'PRODUCT',
    name: r.name_en || 'Product',
    submittedBy: r.partner_name || r.partner_owner || '—',
    submittedAt: r.created_at,
    email: r.partner_email || null,
    category: r.category || null,
    price: r.price_cents != null ? r.price_cents / 100 : null,
    stock: r.stock ?? null,
    imageUrl: r.image_url || null,
    detail: {
      name: r.name_en || null,
      category: r.category || null,
      price: r.price_cents != null ? r.price_cents / 100 : null,
      stock: r.stock ?? null,
      imageUrl: r.image_url || null,
      partnerName: r.partner_name || null,
      partnerOwner: r.partner_owner || null,
      partnerEmail: r.partner_email || null,
      submittedAt: r.created_at,
    },
  };
}

function approvalEmail(type, name, action, extra = {}) {
  const approved = action === 'approve';
  const subject = approved
    ? `Your ${type === 'PARTNER' ? 'partner account' : 'product'} has been approved — Ema Store`
    : `Update on your ${type === 'PARTNER' ? 'partner application' : 'product submission'} — Ema Store`;
  const verdict = approved ? 'approved' : 'rejected';
  const body = approved
    ? `<p>Hello,</p><p>Good news! Your ${type === 'PARTNER' ? 'partner account' : `product "${name}"`} has been <strong>approved</strong> on Ema Store.${extra.note ? ` ${extra.note}` : ''}</p><p>Thank you for choosing Ema Store.</p>`
    : `<p>Hello,</p><p>Unfortunately, your ${type === 'PARTNER' ? 'partner application' : `product submission "${name}"`} has been <strong>rejected</strong> on Ema Store.${extra.reason ? ` Reason: ${extra.reason}` : ''}</p><p>If you believe this is a mistake, please contact our support team.</p>`;
  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><h2 style="color:#166534">Ema Store</h2>${body}<hr><p style="color:#666;font-size:12px">This is an automated message from Ema Store.</p></div>`,
    text: body.replace(/<[^>]+>/g, ''),
  };
}

// POST /api/v1/admin/approvals/:type/:id/review  { action: 'approve'|'reject', reason? }
const reviewApproval = async (req, res, next) => {
  try {
    const type = String(req.params.type || '').toUpperCase();
    const id = req.params.id;
    const action = String(req.body?.action || '').toLowerCase();
    const reason = req.body?.reason ? String(req.body.reason).slice(0, 500) : null;

    if (!['PARTNER', 'PRODUCT'].includes(type)) {
      return error(res, 'Invalid approval type', 400, 'INVALID_TYPE');
    }
    if (!['approve', 'reject'].includes(action)) {
      return error(res, 'Action must be "approve" or "reject"', 400, 'INVALID_ACTION');
    }
    if (action === 'reject' && !reason) {
      return error(res, 'A rejection reason is required', 400, 'REASON_REQUIRED');
    }

    let emailTo = null;
    let displayName = null;

    if (type === 'PARTNER') {
      const { rows } = await pool.query(`
        SELECT pp.id, pp.user_id, pp.business_name, pp.shop_name, pp.owner_name,
               pp.email AS partner_email, u.email AS user_email
        FROM partner_profile pp JOIN users u ON u.id = pp.user_id
        WHERE pp.id = $1`, [id]);
      if (!rows[0]) return error(res, 'Partner not found', 404, 'NOT_FOUND');
      const p = rows[0];
      displayName = p.business_name || p.shop_name || p.owner_name || 'Partner';
      emailTo = p.partner_email || p.user_email || null;

      if (action === 'approve') {
        await pool.query(
          `UPDATE partner_profile SET is_verified = true, is_active = true, updated_at = NOW() WHERE id = $1`,
          [id]);
      } else {
        await pool.query(
          `UPDATE partner_profile SET is_verified = false, is_active = false, updated_at = NOW() WHERE id = $1`,
          [id]);
      }
    } else {
      const { rows } = await pool.query(`
        SELECT p.id, p.name_en, p.status, u.email AS partner_email
        FROM products p LEFT JOIN users u ON u.id = p.partner_id
        WHERE p.id = $1`, [id]);
      if (!rows[0]) return error(res, 'Product not found', 404, 'NOT_FOUND');
      const p = rows[0];
      displayName = p.name_en || 'Product';
      emailTo = p.partner_email || null;

      await pool.query(
        `UPDATE products SET status = $1, updated_at = NOW() WHERE id = $2`,
        [action === 'approve' ? 'APPROVED' : 'REJECTED', id]);
    }

    if (emailTo) {
      const mail = approvalEmail(type, displayName, action, { reason });
      await sendMail({ to: emailTo, ...mail });
    }

    ok(res, { reviewed: true, type, action, emailSent: Boolean(emailTo) });
  } catch (err) {
    next(err);
  }
};

module.exports = { getApprovals, reviewApproval };
