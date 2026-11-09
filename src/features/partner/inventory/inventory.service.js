const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');

async function getInventory(partnerId) {
  const { rows } = await pool.query(
    `SELECT id, name_en, stock, is_visible
     FROM products
     WHERE partner_id = $1
     ORDER BY name_en`,
    [partnerId],
  );
  return rows;
}

async function updateStock(partnerId, productId, quantity) {
  const { rows } = await pool.query(
    `UPDATE products SET stock = $1, updated_at = NOW()
     WHERE id = $2 AND partner_id = $3
     RETURNING id, name_en, stock`,
    [quantity, productId, partnerId],
  );
  if (rows.length === 0) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  return rows[0];
}

module.exports = { getInventory, updateStock };
