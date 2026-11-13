const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// ============================================================================
// FLASH DEALS SERVICE
// Handles:
// 1. Creating flash deals with start/end times
// 2. Managing active deals
// 3. Applying discounts to products
// ============================================================================

// ── Create Flash Deal ─────────────────────────────────────────────────────

async function createFlashDeal({
  title,
  description,
  discountPercent,
  productIds,
  categoryIds,
  startsAt,
  endsAt,
  imageUrl,
  createdBy,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create flash deal
    const { rows: dealRows } = await client.query(
      `INSERT INTO flash_deals (title, description, discount_percent, starts_at, ends_at, image_url, created_by, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id`,
      [title, description, discountPercent, startsAt, endsAt, imageUrl, createdBy],
    );

    const dealId = dealRows[0].id;

    // Link products if provided
    if (productIds && productIds.length > 0) {
      for (const productId of [...new Set(productIds)]) {
        await client.query(
          `INSERT INTO flash_deal_products (flash_deal_id, product_id)
           VALUES ($1, $2)
           ON CONFLICT (flash_deal_id, product_id) DO NOTHING`,
          [dealId, productId],
        );
      }
    }

    // Link categories if provided
    if (categoryIds && categoryIds.length > 0) {
      for (const categoryId of [...new Set(categoryIds)]) {
        await client.query(
          `INSERT INTO flash_deal_categories (flash_deal_id, category_id)
           VALUES ($1, $2::varchar)
           ON CONFLICT (flash_deal_id, category_id) DO NOTHING`,
          [dealId, categoryId],
        );
      }
    }

    await client.query('COMMIT');

    return getFlashDealById(dealId);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// ── Get Flash Deal by ID ───────────────────────────────────────────────────

async function getFlashDealById(dealId) {
  const { rows } = await pool.query(
    `SELECT * FROM flash_deals WHERE id = $1`,
    [dealId],
  );

  if (rows.length === 0) {
    throw new AppError('Flash deal not found', 404, 'DEAL_NOT_FOUND');
  }

  const deal = rows[0];

  // Get associated products (image comes from product_images — products has no image_url column)
  const { rows: productRows } = await pool.query(
    `SELECT p.id, p.name_en, p.price_cents, p.discount_cents, pi.image_url
     FROM flash_deal_products fdp
     JOIN products p ON p.id = fdp.product_id
     LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
     WHERE fdp.flash_deal_id = $1`,
    [dealId],
  );

  return {
    ...deal,
    products: productRows,
  };
}

// ── Get All Flash Deals ───────────────────────────────────────────────────

async function getAllFlashDeals({ includeExpired = true, limit = 100, offset = 0 } = {}) {
  // Admin view: paused (is_active = false) deals must still be listed so they can be re-activated.
  const { rows } = await pool.query(
    `SELECT * FROM flash_deals
     ${includeExpired ? '' : 'WHERE ends_at > NOW()'}
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  return rows;
}

// ── Get Active Flash Deals (for customers) ───────────────────────────────

async function getActiveFlashDeals() {
  const { rows } = await pool.query(
    `SELECT * FROM flash_deals
     WHERE is_active = true
     AND starts_at <= NOW()
     AND ends_at > NOW()
     ORDER BY ends_at ASC`,
  );

  return rows;
}

// ── Update Flash Deal ─────────────────────────────────────────────────────

async function updateFlashDeal(dealId, updates) {
  const n = (v) => (v === undefined ? null : v);
  const { title, description, discountPercent, startsAt, endsAt, imageUrl, isActive } = updates;

  const { rows } = await pool.query(
    `UPDATE flash_deals
     SET title = COALESCE($1, title),
         description = COALESCE($2, description),
         discount_percent = COALESCE($3, discount_percent),
         starts_at = COALESCE($4, starts_at),
         ends_at = COALESCE($5, ends_at),
         image_url = COALESCE($6, image_url),
         is_active = COALESCE($7, is_active),
         updated_at = NOW()
     WHERE id = $8
     RETURNING *`,
    [n(title), n(description), n(discountPercent), n(startsAt), n(endsAt), n(imageUrl), n(isActive), dealId],
  );

  if (rows.length === 0) {
    throw new AppError('Flash deal not found', 404, 'DEAL_NOT_FOUND');
  }

  return getFlashDealById(dealId);
}

// ── Delete Flash Deal ─────────────────────────────────────────────────────

async function deleteFlashDeal(dealId) {
  const { rowCount } = await pool.query(
    `DELETE FROM flash_deals WHERE id = $1`,
    [dealId],
  );

  if (rowCount === 0) {
    throw new AppError('Flash deal not found', 404, 'DEAL_NOT_FOUND');
  }
}

// ── Get Flash Deal Products with Applied Discount ─────────────────────────

async function getFlashDealProducts(dealId) {
  const { rows } = await pool.query(
    `SELECT
       p.*,
       pi.image_url AS primary_image_url,
       c.name_en AS category_name,
       p.discount_cents AS original_discount,
       fd.discount_percent AS flash_discount,
       (p.price_cents * (1 - fd.discount_percent / 100.0))::integer AS discounted_price,
       p.rating_avg,
       p.rating_count,
       p.stock
     FROM flash_deal_products fdp
     JOIN products p ON p.id = fdp.product_id
     JOIN flash_deals fd ON fd.id = fdp.flash_deal_id
     LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
     LEFT JOIN categories c ON p.category = c.id
     WHERE fdp.flash_deal_id = $1
       AND p.is_visible = true
     ORDER BY p.name_en`,
    [dealId],
  );

  return rows;
}

// ── Check if deal is currently active ─────────────────────────────────

async function isDealActive(dealId) {
  const { rows } = await pool.query(
    `SELECT is_active, starts_at, ends_at
     FROM flash_deals
     WHERE id = $1`,
    [dealId],
  );

  if (rows.length === 0) return false;

  const deal = rows[0];
  const now = new Date();

  return (
    deal.is_active &&
    new Date(deal.starts_at) <= now &&
    new Date(deal.ends_at) > now
  );
}

module.exports = {
  createFlashDeal,
  getFlashDealById,
  getAllFlashDeals,
  getActiveFlashDeals,
  updateFlashDeal,
  deleteFlashDeal,
  getFlashDealProducts,
  isDealActive,
};
