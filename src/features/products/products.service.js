const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// ============================================================================
// PRODUCTS SERVICE
// Handles:
// 1. Product CRUD operations
// 2. Category management
// 3. Product images
// 4. Reviews
// ============================================================================

// ── Get All Products (with filters) ───────────────────────────────────────────

async function getAllProducts({
  category,
  search,
  status,
  partnerId,
  limit = 20,
  offset = 0,
} = {}) {
  let query = `
    SELECT
      p.*,
      pi.image_url as primary_image_url,
      c.name_en as category_name,
      c.slug as category_slug,
      pp.business_name as partner_name,
      pp.owner_name as partner_owner
    FROM products p
    LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = true
    LEFT JOIN categories c ON p.category = c.id
    LEFT JOIN partner_profile pp ON p.partner_id = pp.user_id
    WHERE 1=1
  `;

  const params = [];
  let paramIndex = 1;

  if (category) {
    query += ` AND c.slug = $${paramIndex}`;
    params.push(category);
    paramIndex++;
  }

  if (search) {
    query += ` AND (p.name_en ILIKE $${paramIndex} OR p.description_en ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (status) {
    query += ` AND p.status = $${paramIndex}`;
    params.push(status);
    paramIndex++;
  }

  if (partnerId) {
    query += ` AND p.partner_id = $${paramIndex}`;
    params.push(partnerId);
    paramIndex++;
  }

  query += ` ORDER BY p.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);

  return rows.map(row => ({
    id: row.id,
    partnerId: row.partner_id,
    categoryId: row.category,
    brandId: row.brand_id,
    nameEn: row.name_en,
    nameAm: row.name_am,
    nameOm: row.name_om,
    descriptionEn: row.description_en,
    descriptionAm: row.description_am,
    descriptionOm: row.description_om,
    deliveryInfo: row.delivery_info,
    priceCents: row.price_cents,
    discountCents: row.discount_cents,
    sku: row.sku,
    stock: row.stock,
    status: row.status || 'APPROVED',
    isVisible: row.is_visible !== false,
    ratingAvg: parseFloat(row.rating_avg) || 0,
    ratingCount: row.rating_count || 0,
    soldCount: row.sold_count || 0,
    primaryImageUrl: row.primary_image_url,
    categoryName: row.category_name,
    categorySlug: row.category_slug,
    partnerName: row.partner_name,
    partnerOwner: row.partner_owner,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

// ── Get Product by ID ───────────────────────────────────────────────────────

async function getProductById(id) {
  const { rows } = await pool.query(
    `SELECT
      p.*,
      c.name_en as category_name,
      c.slug as category_slug,
      pp.business_name as partner_name,
      pp.owner_name as partner_owner,
      pp.rating_avg as partner_rating,
      pp.rating_count as partner_review_count
     FROM products p
     LEFT JOIN categories c ON p.category = c.id
     LEFT JOIN partner_profile pp ON p.partner_id = pp.user_id
     WHERE p.id = $1`,
    [id],
  );

  if (rows.length === 0) {
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  const product = rows[0];

  // Get all images
  const { rows: images } = await pool.query(
    `SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order`,
    [id],
  );

  // Get variants
  const { rows: variants } = await pool.query(
    `SELECT * FROM product_variants WHERE product_id = $1`,
    [id],
  );

  return {
    ...product,
    images: images,
    variants: variants,
  };
}

// ── Create Product ─────────────────────────────────────────────────────────

async function createProduct(data) {
  const {
    partnerId,
    categoryId,
    brandId,
    nameEn,
    descriptionEn,
    deliveryInfo,
    priceCents,
    discountCents,
    sku,
    stock,
    images = [],
  } = data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO products
       (partner_id, category, brand_id, name_en, description_en, delivery_info,
        price_cents, discount_cents, sku, stock, status, is_visible)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', true)
       RETURNING *`,
      [
        partnerId, categoryId, brandId, nameEn, descriptionEn, deliveryInfo,
        priceCents, discountCents, sku, stock,
      ],
    );

    const product = rows[0];

    // Add images
    for (let i = 0; i < images.length; i++) {
      await client.query(
        `INSERT INTO product_images (product_id, image_url, is_primary, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [product.id, images[i].url, i === 0, i],
      );
    }

    await client.query('COMMIT');
    return getProductById(product.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Update Product ─────────────────────────────────────────────────────────

async function updateProduct(id, data) {
  const {
    categoryId,
    brandId,
    nameEn,
    descriptionEn,
    deliveryInfo,
    priceCents,
    discountCents,
    stock,
    status,
    isVisible,
  } = data;

  const { rows } = await pool.query(
    `UPDATE products
     SET category = COALESCE($1, category),
         brand_id = COALESCE($2, brand_id),
         name_en = COALESCE($3, name_en),
         description_en = COALESCE($4, description_en),
         delivery_info = COALESCE($5, delivery_info),
         price_cents = COALESCE($6, price_cents),
         discount_cents = COALESCE($7, discount_cents),
         stock = COALESCE($8, stock),
         status = COALESCE($9, status),
         is_visible = COALESCE($10, is_visible),
         updated_at = NOW()
     WHERE id = $11
     RETURNING *`,
    [
      categoryId, brandId, nameEn, descriptionEn, deliveryInfo,
      priceCents, discountCents, stock, status, isVisible, id,
    ],
  );

  if (rows.length === 0) {
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }

  return getProductById(id);
}

// ── Delete Product ─────────────────────────────────────────────────────────

async function deleteProduct(id) {
  const { rowCount } = await pool.query(
    'DELETE FROM products WHERE id = $1',
    [id],
  );

  if (rowCount === 0) {
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  }
}

// ── Get Categories ───────────────────────────────────────────────────────

async function getAllCategories() {
  const { rows } = await pool.query(
    `SELECT * FROM categories WHERE is_active = true ORDER BY order_index, name_en`,
  );

  return rows;
}

// ── Get Product Reviews ───────────────────────────────────────────────────

async function getProductReviews(productId, limit = 20, offset = 0) {
  const { rows } = await pool.query(
    `SELECT
      r.*,
      u.id as customer_id,
      cu.full_name as customer_name,
      r.helpful_count
     FROM reviews r
     LEFT JOIN users u ON r.customer_id = u.id
     LEFT JOIN customer_user cu ON cu.user_id = u.id
     WHERE r.product_id = $1 AND r.is_approved = true
     ORDER BY r.created_at DESC
     LIMIT $2 OFFSET $3`,
    [productId, limit, offset],
  );

  return rows;
}

// ── Update Product Rating ───────────────────────────────────────────────

async function updateProductRating(productId) {
  const { rows } = await pool.query(
    `SELECT AVG(rating) as avg_rating, COUNT(*) as count
     FROM reviews
     WHERE product_id = $1 AND is_approved = true`,
    [productId],
  );

  const { avg_rating, count } = rows[0];

  await pool.query(
    `UPDATE products
     SET rating_avg = COALESCE($1, 0),
         rating_count = COALESCE($2, 0),
         updated_at = NOW()
     WHERE id = $3`,
    [avg_rating, count, productId],
  );
}

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getAllCategories,
  getProductReviews,
  updateProductRating,
};
