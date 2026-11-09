const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');

async function getProducts(partnerId, { page = 1, limit = 20, search } = {}) {
  const offset = (page - 1) * limit;
  const params = [partnerId];
  let where = `WHERE p.partner_id = $1`;

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (p.name_en ILIKE $${params.length} OR p.description_en ILIKE $${params.length})`;
  }

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM products p ${where}`,
    params,
  );

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT p.*, pi.image_url AS primary_image_url
     FROM products p
     LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
     ${where}
     ORDER BY p.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { products: rows, total: countRows[0].total, page, limit };
}

async function getProduct(partnerId, productId) {
  const { rows } = await pool.query(
    `SELECT p.*, pi.image_url AS primary_image_url
     FROM products p
     LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
     WHERE p.id = $1 AND p.partner_id = $2`,
    [productId, partnerId],
  );
  if (rows.length === 0) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');

  const product = rows[0];
  const { rows: images } = await pool.query(
    `SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order`,
    [productId],
  );
  return { ...product, images };
}

async function createProduct(partnerId, data) {
  const {
    nameEn, nameAm, nameOm,
    descriptionEn, descriptionAm, descriptionOm,
    deliveryInfo, priceCents, discountCents, sku,
    stock, categoryId, brandId,
  } = data;

  const { rows } = await pool.query(
    `INSERT INTO products
       (partner_id, category, brand_id, name_en, name_am, name_om,
        description_en, description_am, description_om, delivery_info,
        price_cents, discount_cents, sku, stock, status, is_visible)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PENDING',true)
     RETURNING *`,
    [
      partnerId, categoryId, brandId, nameEn, nameAm, nameOm,
      descriptionEn, descriptionAm, descriptionOm, deliveryInfo,
      priceCents, discountCents, sku, stock,
    ],
  );
  return rows[0];
}

async function updateProduct(partnerId, productId, data) {
  const {
    nameEn, nameAm, nameOm,
    descriptionEn, descriptionAm, descriptionOm,
    deliveryInfo, priceCents, discountCents, sku,
    stock, categoryId, brandId,
  } = data;

  const { rows } = await pool.query(
    `UPDATE products
     SET category       = COALESCE($1, category),
         brand_id       = COALESCE($2, brand_id),
         name_en        = COALESCE($3, name_en),
         name_am        = COALESCE($4, name_am),
         name_om        = COALESCE($5, name_om),
         description_en = COALESCE($6, description_en),
         description_am = COALESCE($7, description_am),
         description_om = COALESCE($8, description_om),
         delivery_info  = COALESCE($9, delivery_info),
         price_cents    = COALESCE($10, price_cents),
         discount_cents = COALESCE($11, discount_cents),
         sku            = COALESCE($12, sku),
         stock          = COALESCE($13, stock),
         updated_at     = NOW()
     WHERE id = $14 AND partner_id = $15
     RETURNING *`,
    [
      categoryId, brandId, nameEn, nameAm, nameOm,
      descriptionEn, descriptionAm, descriptionOm, deliveryInfo,
      priceCents, discountCents, sku, stock,
      productId, partnerId,
    ],
  );
  if (rows.length === 0) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  return rows[0];
}

async function deleteProduct(partnerId, productId) {
  const { rowCount } = await pool.query(
    `DELETE FROM products WHERE id = $1 AND partner_id = $2`,
    [productId, partnerId],
  );
  if (rowCount === 0) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
}

async function toggleVisibility(partnerId, productId) {
  const { rows } = await pool.query(
    `UPDATE products SET is_visible = NOT is_visible, updated_at = NOW()
     WHERE id = $1 AND partner_id = $2
     RETURNING id, is_visible`,
    [productId, partnerId],
  );
  if (rows.length === 0) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  return rows[0];
}

async function uploadImage(partnerId, productId, imageUrl) {
  // Verify ownership
  const { rows: prodRows } = await pool.query(
    `SELECT id FROM products WHERE id = $1 AND partner_id = $2`,
    [productId, partnerId],
  );
  if (prodRows.length === 0) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');

  // Check if this product already has a primary image
  const { rows: existingPrimary } = await pool.query(
    `SELECT id FROM product_images WHERE product_id = $1 AND is_primary = true`,
    [productId],
  );

  const isPrimary = existingPrimary.length === 0;
  const { rows } = await pool.query(
    `INSERT INTO product_images (product_id, image_url, is_primary)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [productId, imageUrl, isPrimary],
  );
  return rows[0];
}

async function deleteImage(partnerId, productId, imgId) {
  // Verify ownership
  const { rows: prodRows } = await pool.query(
    `SELECT id FROM products WHERE id = $1 AND partner_id = $2`,
    [productId, partnerId],
  );
  if (prodRows.length === 0) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');

  const { rowCount } = await pool.query(
    `DELETE FROM product_images WHERE id = $1 AND product_id = $2`,
    [imgId, productId],
  );
  if (rowCount === 0) throw new AppError('Image not found.', 404, 'IMAGE_NOT_FOUND');
}

module.exports = {
  getProducts, getProduct, createProduct, updateProduct,
  deleteProduct, toggleVisibility, uploadImage, deleteImage,
};
