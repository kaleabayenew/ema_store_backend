const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');

// Ensure table exists
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_promotions (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      partner_id       UUID REFERENCES users(id),
      title            VARCHAR(255),
      discount_percent INT,
      product_ids      JSONB DEFAULT '[]',
      starts_at        TIMESTAMPTZ,
      ends_at          TIMESTAMPTZ,
      is_active        BOOLEAN DEFAULT true,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
ensureSchema().catch(err => console.warn('[Partner Promotions] Schema init:', err.message));

async function getPromotions(partnerId) {
  const { rows } = await pool.query(
    `SELECT * FROM partner_promotions WHERE partner_id = $1 ORDER BY created_at DESC`,
    [partnerId],
  );
  return rows;
}

async function createPromotion(partnerId, data) {
  const { title, discountPercent, productIds, startsAt, endsAt } = data;
  const { rows } = await pool.query(
    `INSERT INTO partner_promotions (partner_id, title, discount_percent, product_ids, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [partnerId, title, discountPercent, JSON.stringify(productIds || []), startsAt, endsAt],
  );
  return rows[0];
}

async function updatePromotion(partnerId, id, data) {
  const { title, discountPercent, productIds, startsAt, endsAt, isActive } = data;
  const { rows } = await pool.query(
    `UPDATE partner_promotions
     SET title            = COALESCE($1, title),
         discount_percent = COALESCE($2, discount_percent),
         product_ids      = COALESCE($3, product_ids),
         starts_at        = COALESCE($4, starts_at),
         ends_at          = COALESCE($5, ends_at),
         is_active        = COALESCE($6, is_active)
     WHERE id = $7 AND partner_id = $8
     RETURNING *`,
    [
      title, discountPercent,
      productIds !== undefined ? JSON.stringify(productIds) : null,
      startsAt, endsAt, isActive,
      id, partnerId,
    ],
  );
  if (rows.length === 0) throw new AppError('Promotion not found.', 404, 'PROMOTION_NOT_FOUND');
  return rows[0];
}

async function deletePromotion(partnerId, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM partner_promotions WHERE id = $1 AND partner_id = $2`,
    [id, partnerId],
  );
  if (rowCount === 0) throw new AppError('Promotion not found.', 404, 'PROMOTION_NOT_FOUND');
}

module.exports = { getPromotions, createPromotion, updatePromotion, deletePromotion };
