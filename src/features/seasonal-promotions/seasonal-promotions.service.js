const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// ============================================================================
// SEASONAL PROMOTIONS SERVICE
// Admin-created promotional campaigns shown in the customer app's
// Seasonal Promotions page, filterable by category tabs.
// ============================================================================

const VALID_CATEGORIES = [
  'all', 'fashion', 'electronics', 'shoes', 'food-drink',
  'phones', 'watches', 'home-living',
];

async function createPromotion({
  title,
  subtitle,
  description,
  imageUrl,
  category,
  discountPercent,
  startsAt,
  endsAt,
  sortOrder,
  productIds,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO seasonal_promotions
         (title, subtitle, description, image_url, category,
          discount_percent, starts_at, ends_at, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
       RETURNING *`,
      [
        title,
        subtitle || null,
        description || null,
        imageUrl || null,
        category || 'all',
        discountPercent ?? null,
        startsAt,
        endsAt,
        sortOrder ?? 0,
      ],
    );
    const promo = rows[0];

    if (Array.isArray(productIds) && productIds.length > 0) {
      for (const pid of [...new Set(productIds)]) {
        await client.query(
          `INSERT INTO seasonal_promotion_products (promotion_id, product_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [promo.id, pid],
        );
      }
    }

    await client.query('COMMIT');
    return promo;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function getAllPromotions({ includeExpired = true, limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM seasonal_promotions
     ${includeExpired ? '' : 'WHERE ends_at > NOW()'}
     ORDER BY sort_order ASC, created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

async function getActivePromotions() {
  const { rows } = await pool.query(
    `SELECT * FROM seasonal_promotions
     WHERE is_active = true
       AND starts_at <= NOW()
       AND ends_at > NOW()
     ORDER BY sort_order ASC, ends_at ASC`,
  );
  return rows;
}

async function getPromotionById(id) {
  const { rows } = await pool.query(
    `SELECT * FROM seasonal_promotions WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) {
    throw new AppError('Promotion not found', 404, 'PROMOTION_NOT_FOUND');
  }
  const promo = rows[0];
  const { rows: links } = await pool.query(
    `SELECT product_id FROM seasonal_promotion_products WHERE promotion_id = $1`,
    [id],
  );
  return { ...promo, product_ids: links.map((l) => l.product_id) };
}

// Products attached to a promotion with the promo discount applied.
async function getPromotionProducts(id) {
  const { rows } = await pool.query(
    `SELECT
       p.id, p.name_en, p.price_cents, p.discount_cents,
       pi.image_url AS primary_image_url,
       c.name_en AS category_name,
       p.rating_avg, p.rating_count, p.stock,
       sp.discount_percent AS promo_discount,
       CASE WHEN sp.discount_percent IS NOT NULL
            THEN (p.price_cents * (1 - sp.discount_percent / 100.0))::integer
            ELSE p.price_cents END AS promo_price_cents
     FROM seasonal_promotion_products spp
     JOIN seasonal_promotions sp ON sp.id = spp.promotion_id
     JOIN products p ON p.id = spp.product_id
     LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
     LEFT JOIN categories c ON p.category = c.id
     WHERE spp.promotion_id = $1
       AND sp.is_active = true
       AND sp.starts_at <= NOW()
       AND sp.ends_at > NOW()
       AND p.is_visible = true
     ORDER BY p.name_en`,
    [id],
  );
  return rows;
}

async function setPromotionProducts(promotionId, productIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM seasonal_promotion_products WHERE promotion_id = $1`,
      [promotionId],
    );
    if (Array.isArray(productIds) && productIds.length > 0) {
      for (const pid of [...new Set(productIds)]) {
        await client.query(
          `INSERT INTO seasonal_promotion_products (promotion_id, product_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [promotionId, pid],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function updatePromotion(id, updates) {
  const n = (v) => (v === undefined ? null : v);
  const { productIds, ...fields } = updates;
  const { rows } = await pool.query(
    `UPDATE seasonal_promotions
     SET title            = COALESCE($1, title),
         subtitle         = COALESCE($2, subtitle),
         description      = COALESCE($3, description),
         image_url        = COALESCE($4, image_url),
         category         = COALESCE($5, category),
         discount_percent = COALESCE($6, discount_percent),
         starts_at        = COALESCE($7, starts_at),
         ends_at          = COALESCE($8, ends_at),
         sort_order       = COALESCE($9, sort_order),
         is_active        = COALESCE($10, is_active),
         updated_at       = NOW()
     WHERE id = $11
     RETURNING *`,
    [
      n(fields.title),
      n(fields.subtitle),
      n(fields.description),
      n(fields.imageUrl),
      n(fields.category),
      n(fields.discountPercent),
      n(fields.startsAt),
      n(fields.endsAt),
      n(fields.sortOrder),
      n(fields.isActive),
      id,
    ],
  );
  if (rows.length === 0) {
    throw new AppError('Promotion not found', 404, 'PROMOTION_NOT_FOUND');
  }
  if (productIds !== undefined) {
    await setPromotionProducts(id, Array.isArray(productIds) ? productIds : []);
  }
  return rows[0];
}

async function deletePromotion(id) {
  const { rowCount } = await pool.query(
    `DELETE FROM seasonal_promotions WHERE id = $1`,
    [id],
  );
  if (rowCount === 0) {
    throw new AppError('Promotion not found', 404, 'PROMOTION_NOT_FOUND');
  }
}

// Returns the active promotion (id + discount) that applies to a product.
// If promotionId is given it must be that promo; otherwise the best
// (highest discount) active promo containing the product wins.
async function resolvePromotionForProduct(productId, promotionId = null) {
  const { rows } = await pool.query(
    `SELECT sp.id, sp.discount_percent
     FROM seasonal_promotion_products spp
     JOIN seasonal_promotions sp ON sp.id = spp.promotion_id
     WHERE spp.product_id = $1
       AND sp.is_active = true
       AND sp.starts_at <= NOW()
       AND sp.ends_at > NOW()
       AND sp.discount_percent IS NOT NULL
       ${promotionId ? 'AND sp.id = $2' : ''}
     ORDER BY sp.discount_percent DESC
     LIMIT 1`,
    promotionId ? [productId, promotionId] : [productId],
  );
  return rows[0] || null;
}

module.exports = {
  VALID_CATEGORIES,
  createPromotion,
  getAllPromotions,
  getActivePromotions,
  getPromotionById,
  getPromotionProducts,
  resolvePromotionForProduct,
  updatePromotion,
  deletePromotion,
};
