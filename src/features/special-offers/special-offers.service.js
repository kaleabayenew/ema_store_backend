const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// ── Get all active special offers ──────────────────────────────────────────

async function getActiveSpecialOffers() {
  const { rows } = await pool.query(
    `SELECT * FROM special_offers 
     WHERE is_active = true 
     AND starts_at <= NOW() 
     AND ends_at > NOW()
     ORDER BY ends_at ASC`
  );

  return rows.map(offer => ({
    id: offer.id,
    title: offer.title,
    description: offer.description,
    discountPercentage: parseFloat(offer.discount_percentage),
    minPurchase: parseFloat(offer.min_purchase),
    maxDiscount: offer.max_discount ? parseFloat(offer.max_discount) : null,
    startsAt: offer.starts_at,
    endsAt: offer.ends_at,
    productIds: offer.product_ids,
  }));
}

// ── Get special offer by ID ─────────────────────────────────────────────

async function getSpecialOfferById(id) {
  const { rows } = await pool.query(
    'SELECT * FROM special_offers WHERE id = $1',
    [id]
  );

  if (rows.length === 0) {
    throw new AppError('Special offer not found', 404, 'OFFER_NOT_FOUND');
  }

  const offer = rows[0];
  return {
    id: offer.id,
    title: offer.title,
    description: offer.description,
    discountPercentage: parseFloat(offer.discount_percentage),
    minPurchase: parseFloat(offer.min_purchase),
    maxDiscount: offer.max_discount ? parseFloat(offer.max_discount) : null,
    startsAt: offer.starts_at,
    endsAt: offer.ends_at,
    productIds: offer.product_ids,
    isActive: offer.is_active,
  };
}

// ── Create special offer (admin only) ───────────────────────────────────────

async function createSpecialOffer(data) {
  const {
    title,
    description,
    discountPercentage,
    minPurchase = 0,
    maxDiscount,
    startsAt,
    endsAt,
    productIds = [],
  } = data;

  const { rows } = await pool.query(
    `INSERT INTO special_offers (title, description, discount_percentage, min_purchase, max_discount, starts_at, ends_at, product_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [title, description, discountPercentage, minPurchase, maxDiscount, startsAt, endsAt, productIds]
  );

  return getSpecialOfferById(rows[0].id);
}

// ── Update special offer (admin only) ───────────────────────────────────────

async function updateSpecialOffer(id, data) {
  const {
    title,
    description,
    discountPercentage,
    minPurchase,
    maxDiscount,
    startsAt,
    endsAt,
    productIds,
    isActive,
  } = data;

  const { rows } = await pool.query(
    `UPDATE special_offers
     SET title = COALESCE($1, title),
         description = COALESCE($2, description),
         discount_percentage = COALESCE($3, discount_percentage),
         min_purchase = COALESCE($4, min_purchase),
         max_discount = COALESCE($5, max_discount),
         starts_at = COALESCE($6, starts_at),
         ends_at = COALESCE($7, ends_at),
         product_ids = COALESCE($8, product_ids),
         is_active = COALESCE($9, is_active),
         updated_at = NOW()
     WHERE id = $10
     RETURNING *`,
    [title, description, discountPercentage, minPurchase, maxDiscount, startsAt, endsAt, productIds, isActive, id]
  );

  if (rows.length === 0) {
    throw new AppError('Special offer not found', 404, 'OFFER_NOT_FOUND');
  }

  return getSpecialOfferById(id);
}

// ── Delete special offer (admin only) ───────────────────────────────────────

async function deleteSpecialOffer(id) {
  const { rowCount } = await pool.query(
    'DELETE FROM special_offers WHERE id = $1',
    [id]
  );

  if (rowCount === 0) {
    throw new AppError('Special offer not found', 404, 'OFFER_NOT_FOUND');
  }
}

module.exports = {
  getActiveSpecialOffers,
  getSpecialOfferById,
  createSpecialOffer,
  updateSpecialOffer,
  deleteSpecialOffer,
};
