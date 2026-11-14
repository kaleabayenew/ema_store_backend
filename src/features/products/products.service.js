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

// coin_price may be missing when the startup migration fails (cold DB).
// Ensure it once per process so product queries never 500.
let _coinPriceEnsured = null;
function ensureCoinPriceColumn() {
  if (!_coinPriceEnsured) {
    _coinPriceEnsured = pool
      .query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS coin_price INTEGER`)
      .catch(() => {});
  }
  return _coinPriceEnsured;
}

function _formatProductForList(row) {
  const priceCents = parseInt(row.price_cents) || 0;
  const discountCents = parseInt(row.discount_cents) || 0;
  const ratingAvg = parseFloat(row.rating_avg) || 0;
  const ratingCount = parseInt(row.rating_count) || 0;
  const soldCount = parseInt(row.sold_count) || 0;
  const stock = parseInt(row.stock) || 0;
  const primaryImg = row.primary_image_url || row.image_url || '';

  return {
    id: row.id,
    name: row.name_en || row.name || 'Product',
    category: row.category,
    price: Math.round(priceCents / 100),
    priceCents,
    discountCents,
    coinPrice: row.coin_price !== null && row.coin_price !== undefined ? parseInt(row.coin_price, 10) : null,
    rating: ratingAvg,
    reviewCount: ratingCount,
    imageUrl: primaryImg,
    stock,
    status: row.status || 'APPROVED',
    primaryImageUrl: primaryImg,
    categoryName: row.category_name,
    categorySlug: row.category_slug,
  };
}

function _formatProduct(row) {
  const priceCents = parseInt(row.price_cents) || 0;
  const discountCents = parseInt(row.discount_cents) || 0;
  const ratingAvg = parseFloat(row.rating_avg) || 0;
  const ratingCount = parseInt(row.rating_count) || 0;
  const soldCount = parseInt(row.sold_count) || 0;
  const stock = parseInt(row.stock) || 0;
  const primaryImg = row.primary_image_url || row.image_url || '';

  return {
    id: row.id,
    partnerId: row.partner_id,
    partner_id: row.partner_id,
    categoryId: row.category,
    category: row.category,
    brandId: row.brand_id,
    brand_id: row.brand_id,
    name: row.name_en || row.name || 'Product',
    nameEn: row.name_en,
    nameAm: row.name_am,
    nameOm: row.name_om,
    name_en: row.name_en,
    name_am: row.name_am,
    name_om: row.name_om,
    description: row.description_en || row.description || '',
    descriptionEn: row.description_en,
    descriptionAm: row.description_am,
    descriptionOm: row.description_om,
    description_en: row.description_en,
    description_am: row.description_am,
    description_om: row.description_om,
    deliveryInfo: row.delivery_info,
    delivery_info: row.delivery_info,
    priceCents,
    price_cents: priceCents,
    discountCents,
    discount_cents: discountCents,
    coinPrice: row.coin_price !== null && row.coin_price !== undefined ? parseInt(row.coin_price, 10) : null,
    coin_price: row.coin_price !== null && row.coin_price !== undefined ? parseInt(row.coin_price, 10) : null,
    sku: row.sku,
    stock,
    status: row.status || 'APPROVED',
    isVisible: row.is_visible !== false,
    is_visible: row.is_visible !== false,
    ratingAvg,
    rating_avg: ratingAvg,
    ratingCount,
    rating_count: ratingCount,
    soldCount,
    sold_count: soldCount,
    primaryImageUrl: primaryImg,
    image_url: primaryImg,
    categoryName: row.category_name,
    category_name: row.category_name,
    categorySlug: row.category_slug,
    category_slug: row.category_slug,
    partnerName: row.partner_name,
    partner_name: row.partner_name,
    partnerOwner: row.partner_owner,
    partner_owner: row.partner_owner,
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  };
}

// ── Get All Products (with filters) ───────────────────────────────────────────

async function getAllProducts({
  category,
  search,
  status,
  partnerId,
  limit = 20,
  offset = 0,
  lean = false,
} = {}) {
  await ensureCoinPriceColumn();
  const fromAndWhere = `
    FROM products p
    LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = true
    LEFT JOIN categories c ON p.category = c.id
    LEFT JOIN partner_profile pp ON p.partner_id = pp.user_id
    WHERE 1=1
  `;

  const params = [];
  let paramIndex = 1;
  let where = '';

  if (category) {
    where += ` AND c.slug = $${paramIndex}`;
    params.push(category);
    paramIndex++;
  }

  if (search) {
    where += ` AND (p.name_en ILIKE $${paramIndex} OR p.description_en ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (status) {
    where += ` AND p.status = $${paramIndex}`;
    params.push(status);
    paramIndex++;
  }

  if (partnerId) {
    where += ` AND p.partner_id = $${paramIndex}`;
    params.push(partnerId);
    paramIndex++;
  }

  // Total count + aggregates (without limit/offset)
  const aggRes = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE p.status = 'APPROVED')::int AS approved,
       COUNT(*) FILTER (WHERE p.status = 'PENDING')::int  AS pending,
       COALESCE(AVG(p.rating_avg), 0)::float AS avg_rating
     ${fromAndWhere} ${where}`,
    params,
  );
  const total = aggRes.rows[0]?.total ?? 0;
  const approved = aggRes.rows[0]?.approved ?? 0;
  const pending = aggRes.rows[0]?.pending ?? 0;
  const avgRating = parseFloat(aggRes.rows[0]?.avg_rating ?? 0) || 0;

  // Page query - use lean format for list views
  const pageParams = [...params, limit, offset];
  const query = lean ? `
    SELECT
      p.id,
      p.name_en,
      p.name,
      p.category,
      p.price_cents,
      p.discount_cents,
      p.coin_price,
      p.rating_avg,
      p.rating_count,
      p.stock,
      p.status,
      pi.image_url as primary_image_url,
      c.name_en as category_name,
      c.slug as category_slug
    ${fromAndWhere} ${where}
    ORDER BY p.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  ` : `
    SELECT
      p.*,
      pi.image_url as primary_image_url,
      c.name_en as category_name,
      c.slug as category_slug,
      pp.business_name as partner_name,
      pp.owner_name as partner_owner
    ${fromAndWhere} ${where}
    ORDER BY p.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  const { rows } = await pool.query(query, pageParams);
  const formatter = lean ? _formatProductForList : _formatProduct;
  const products = rows.map(formatter);

  if (!lean && products.length > 0) {
    try {
      const ids = products.map(p => p.id);
      const { rows: allImgs } = await pool.query(
        `SELECT product_id, image_url, is_primary, sort_order
         FROM product_images
         WHERE product_id = ANY($1::uuid[])
         ORDER BY sort_order, created_at`,
        [ids],
      );
      const imagesByProduct = {};
      for (const img of allImgs) {
        (imagesByProduct[img.product_id] ||= []).push(img);
      }
      for (const p of products) {
        const pImgs = imagesByProduct[p.id] || [];
        p.images = pImgs;
        p.imageUrls = pImgs.map(i => i.image_url);
        if (!p.primaryImageUrl && pImgs.length > 0) {
          p.primaryImageUrl = pImgs[0].image_url;
        }
      }
    } catch (_) {}
  }

  return { products, total, approved, pending, avgRating };
}

async function _legacy_mapping_getAllProducts() {

  const products = rows.map(row => ({
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

  return { products, total, approved, pending, avgRating };
}

// ── Get New Arrivals (products sorted by creation date) ─────────────────────

async function getNewArrivals({ limit = 5 } = {}) {
  const query = `
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
    WHERE p.is_visible = true
    ORDER BY p.created_at DESC
    LIMIT $1
  `;

  const { rows } = await pool.query(query, [limit]);
  return rows.map(_formatProduct);
}

async function _legacy_mapping_getNewArrivals() {

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

// ── Get Flash Deal Products (products with discounts) ─────────────────────

async function getFlashDealProducts({ limit = 10 } = {}) {
  const query = `
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
    WHERE p.is_visible = true
      AND p.discount_cents > 0
      AND p.discount_cents < p.price_cents
    ORDER BY p.discount_cents DESC
    LIMIT $1
  `;

  const { rows } = await pool.query(query, [limit]);
  return rows.map(_formatProduct);
}

async function _legacy_mapping_getNewArrivals() {

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

// ── Get Popular Products (sorted by rating and sales) ─────────────────────

async function getPopularProducts({ limit = 10 } = {}) {
  const query = `
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
    WHERE p.is_visible = true
    ORDER BY p.rating_avg DESC, p.sold_count DESC
    LIMIT $1
  `;

  const { rows } = await pool.query(query, [limit]);
  return rows.map(_formatProduct);
}

async function _legacy_mapping_getNewArrivals() {

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
  await ensureCoinPriceColumn();
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

  const product = _formatProduct(rows[0]);

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

// ── Get Seller Offers for a Product ──────────────────────────────────────────

async function getSellerOffers(productId) {
  const { rows } = await pool.query(
    `SELECT
       so.*,
       pp.business_name as seller_name,
       pp.rating_avg as seller_rating,
       pp.rating_count as seller_review_count
     FROM seller_offers so
     LEFT JOIN partner_profile pp ON so.seller_id = pp.user_id
     WHERE so.product_id = $1 AND so.is_active = true
     ORDER BY so.price ASC`,
    [productId],
  );

  return rows.map(row => ({
    id: row.id,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    price: row.price,
    rating: row.seller_rating || 4.5,
    reviewCount: row.seller_review_count || 0,
    badge: row.badge,
    badgeColor: row.badge_color,
    deliveryInfo: row.delivery_info,
    isActive: row.is_active,
  }));
}

// ── Get Product Reactions ───────────────────────────────────────────────────

async function getProductReactions(productId) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN reaction_type = 'like' THEN 1 ELSE 0 END), 0) as likes,
       COALESCE(SUM(CASE WHEN reaction_type = 'dislike' THEN 1 ELSE 0 END), 0) as dislikes
     FROM product_reactions
     WHERE product_id = $1`,
    [productId],
  );

  return {
    likes: parseInt(rows[0]?.likes || 0),
    dislikes: parseInt(rows[0]?.dislikes || 0),
  };
}

// ── Get User's Reaction for a Product ─────────────────────────────────────────

async function getUserReaction(productId, userId) {
  const { rows } = await pool.query(
    `SELECT reaction_type FROM product_reactions
     WHERE product_id = $1 AND user_id = $2`,
    [productId, userId],
  );

  if (rows.length === 0) return null;
  return rows[0].reaction_type;
}

// ── Add/Update Reaction ─────────────────────────────────────────────────────

async function setReaction(productId, userId, reaction) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if reaction already exists
    const { rows: existing } = await client.query(
      `SELECT reaction_type FROM product_reactions
       WHERE product_id = $1 AND user_id = $2`,
      [productId, userId],
    );

    if (existing.length > 0) {
      // Update existing reaction
      if (reaction === 'none' || reaction === existing[0].reaction_type) {
        // Remove reaction if same
        await client.query(
          'DELETE FROM product_reactions WHERE product_id = $1 AND user_id = $2',
          [productId, userId],
        );
      } else {
        // Update to new reaction
        await client.query(
          'UPDATE product_reactions SET reaction_type = $1 WHERE product_id = $2 AND user_id = $3',
          [reaction, productId, userId],
        );
      }
    } else if (reaction !== 'none') {
      // Insert new reaction
      await client.query(
        `INSERT INTO product_reactions (product_id, user_id, reaction_type)
         VALUES ($1, $2, $3)`,
        [productId, userId, reaction],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Get Product Viewers Count ─────────────────────────────────────────────────

async function getProductViewers(productId) {
  // This is a simplified version - in production, you'd use a real-time system
  // For now, we'll return a random number between 10 and 100 based on product popularity
  const { rows } = await pool.query(
    `SELECT sold_count, rating_count FROM products WHERE id = $1`,
    [productId],
  );

  if (rows.length === 0) return 0;

  const soldCount = rows[0].sold_count || 0;
  const ratingCount = rows[0].rating_count || 0;

  // Calculate viewers based on product popularity
  const baseViewers = Math.min(100, Math.max(10, Math.floor((soldCount + ratingCount) / 10)));
  return baseViewers;
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

    const product = _formatProduct(rows[0]);

    // Add images (supports string URLs, { url }, { imageUrl }, { image_url })
    const incomingImages = Array.isArray(images) && images.length > 0
      ? images
      : (Array.isArray(data.imageUrls) ? data.imageUrls : []);

    for (let i = 0; i < incomingImages.length; i++) {
      const item = incomingImages[i];
      const imgUrl = typeof item === 'string'
        ? item
        : (item?.url || item?.imageUrl || item?.image_url);
      if (imgUrl) {
        await client.query(
          `INSERT INTO product_images (product_id, image_url, is_primary, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [product.id, imgUrl, i === 0, i],
        );
      }
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

  // Update images if provided
  const incomingImages = Array.isArray(data.images)
    ? data.images
    : (Array.isArray(data.imageUrls) ? data.imageUrls : null);

  if (incomingImages !== null) {
    await pool.query('DELETE FROM product_images WHERE product_id = $1', [id]);
    for (let i = 0; i < incomingImages.length; i++) {
      const item = incomingImages[i];
      const imgUrl = typeof item === 'string'
        ? item
        : (item?.url || item?.imageUrl || item?.image_url);
      if (imgUrl) {
        await pool.query(
          `INSERT INTO product_images (product_id, image_url, is_primary, sort_order)
           VALUES ($1, $2, $3, $4)`,
          [id, imgUrl, i === 0, i],
        );
      }
    }
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
  getNewArrivals,
  getFlashDealProducts,
  getPopularProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getAllCategories,
  getProductReviews,
  updateProductRating,
  getSellerOffers,
  getProductReactions,
  getUserReaction,
  setReaction,
  getProductViewers,
};
