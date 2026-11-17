const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');

/**
 * Shape sent to the partner app. `name` / `imageUrl` are what the Flutter
 * inventory page reads; `name_en` / `is_visible` are kept for backward
 * compatibility with older app builds.
 */
function _mapInventoryRow(row) {
  return {
    id: row.id,
    name: row.name_en || '',
    name_en: row.name_en || '',
    imageUrl: row.image_url || null,
    stock: Number(row.stock) || 0,
    visible: row.is_visible !== false,
    is_visible: row.is_visible !== false,
    category: row.category || null,
    status: ['PENDING', 'APPROVED', 'REJECTED'].includes(row.status)
      ? row.status
      : row.status === 'ACTIVE'
        ? 'APPROVED'
        : 'PENDING',
  };
}

async function getInventory(partnerId) {
  // Primary image first, otherwise the first image by sort order.
  const { rows } = await pool.query(
    `SELECT p.id, p.name_en, p.stock, p.is_visible, p.category, p.status,
            img.image_url
     FROM products p
     LEFT JOIN LATERAL (
       SELECT pi.image_url
       FROM product_images pi
       WHERE pi.product_id = p.id
       ORDER BY pi.is_primary DESC, pi.sort_order, pi.created_at
       LIMIT 1
     ) img ON true
     WHERE p.partner_id = $1
     ORDER BY p.name_en`,
    [partnerId],
  );
  return rows.map(_mapInventoryRow);
}

async function updateStock(partnerId, productId, quantity) {
  const { rows } = await pool.query(
    `UPDATE products SET stock = $1, updated_at = NOW()
     WHERE id = $2 AND partner_id = $3
     RETURNING id, name_en, stock`,
    [quantity, productId, partnerId],
  );
  if (rows.length === 0) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  return { id: rows[0].id, name: rows[0].name_en || '', stock: Number(rows[0].stock) || 0 };
}

module.exports = { getInventory, updateStock };