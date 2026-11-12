const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');

// ─────────────────────────────────────────────────────────────────────────────
//  Mapper — single shape for every endpoint
// ─────────────────────────────────────────────────────────────────────────────

function _mapProduct(row, { images = [], variants = [] } = {}) {
  const priceCents = Number(row.price_cents) || 0;
  const discountCents = Number(row.discount_cents) || 0;
  const imageUrls = images.length
    ? images.map((i) => i.image_url)
    : row.primary_image_url
      ? [row.primary_image_url]
      : row.image_url
        ? [row.image_url]
        : [];

  return {
    id: row.id,
    name: row.name_en || row.name || '',
    nameAm: row.name_am || null,
    nameOm: row.name_om || null,
    description: row.description_en || row.description || '',
    deliveryInfo: row.delivery_info || null,
    category: row.category || null,
    price: priceCents / 100,
    discountPrice: discountCents > 0 ? discountCents / 100 : null,
    stock: Number(row.stock ?? row.stock_quantity) || 0,
    sales: Number(row.sold_count) || 0,
    visible: row.is_visible !== false,
    status: ['PENDING', 'APPROVED', 'REJECTED'].includes(row.status)
      ? row.status
      : row.status === 'ACTIVE'
        ? 'APPROVED'
        : 'PENDING',
    variants: variants.map((v) => {
      const attr = v.attributes && typeof v.attributes === 'object'
        ? v.attributes
        : {};
      const val = attr.value || attr.option || '';
      return val ? `${v.name} / ${val}` : (v.name || '');
    }),
    imageUrls,
    createdAt: row.created_at,
  };
}

async function _attachRelations(rows) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [imgRes, varRes] = await Promise.all([
    pool.query(
      `SELECT product_id, image_url FROM product_images
       WHERE product_id = ANY($1::uuid[]) ORDER BY sort_order, created_at`,
      [ids],
    ),
    pool.query(
      `SELECT product_id, name, attributes FROM product_variants
       WHERE product_id = ANY($1::uuid[]) AND is_active IS NOT FALSE
       ORDER BY created_at`,
      [ids],
    ),
  ]);

  const imagesByProduct = {};
  for (const img of imgRes.rows) {
    (imagesByProduct[img.product_id] ||= []).push(img);
  }
  const variantsByProduct = {};
  for (const v of varRes.rows) {
    (variantsByProduct[v.product_id] ||= []).push(v);
  }

  return rows.map((r) =>
    _mapProduct(r, {
      images: imagesByProduct[r.id] || [],
      variants: variantsByProduct[r.id] || [],
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

function _toCents(value, { birr = false } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return birr ? Math.round(n * 100) : Math.round(n);
}

function _validateProductInput(data, { partial = false } = {}) {
  const name = (data.name ?? data.nameEn ?? '').toString().trim();
  const priceCents =
    _toCents(data.priceCents) ?? _toCents(data.price, { birr: true });
  const discountCents =
    _toCents(data.discountCents) ?? _toCents(data.discountPrice, { birr: true }) ?? 0;
  const stock = data.stock === undefined || data.stock === null
    ? null
    : Math.round(Number(data.stock));

  if (!partial || data.name !== undefined || data.nameEn !== undefined) {
    if (!name) throw new AppError('Product name is required.', 400, 'VALIDATION');
  }
  if (!partial || data.priceCents !== undefined || data.price !== undefined) {
    if (priceCents === null || priceCents <= 0) {
      throw new AppError('Price must be greater than 0.', 400, 'VALIDATION');
    }
  }
  if (stock !== null && (!Number.isFinite(stock) || stock < 0)) {
    throw new AppError('Stock cannot be negative.', 400, 'VALIDATION');
  }
  if (priceCents !== null && discountCents !== null && discountCents >= priceCents) {
    throw new AppError('Discount must be less than the price.', 400, 'VALIDATION');
  }

  return { name, priceCents, discountCents, stock };
}

async function _replaceImages(client, productId, imageUrls) {
  await client.query(`DELETE FROM product_images WHERE product_id = $1`, [productId]);
  for (let i = 0; i < imageUrls.length; i++) {
    await client.query(
      `INSERT INTO product_images (product_id, image_url, is_primary, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [productId, imageUrls[i], i === 0, i],
    );
  }
}

async function _replaceVariants(client, productId, variants) {
  await client.query(`DELETE FROM product_variants WHERE product_id = $1`, [productId]);
  for (const v of variants) {
    const str = String(v).trim();
    if (!str) continue;
    // Accept "Name / Value" or plain string
    const parts = str.split('/').map((s) => s.trim());
    const name = (parts.length > 1 ? parts[0] : str).slice(0, 100) || 'Option';
    const value = parts.length > 1 ? parts.slice(1).join(' / ').slice(0, 100) : '';
    await client.query(
      `INSERT INTO product_variants (product_id, name, attributes, is_active)
       VALUES ($1, $2, $3::jsonb, true)`,
      [productId, name, JSON.stringify(value ? { value } : {})],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Endpoints
// ─────────────────────────────────────────────────────────────────────────────

async function getProducts(partnerId, { page = 1, limit = 50, search } = {}) {
  const offset = (page - 1) * limit;
  const params = [partnerId];
  let where = `WHERE p.partner_id = $1`;

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (p.name_en ILIKE $${params.length} OR p.description_en ILIKE $${params.length})`;
  }

  const [countRes, rowsRes] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM products p ${where}`, params),
    pool.query(
      `SELECT p.*, pi.image_url AS primary_image_url
       FROM products p
       LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = true
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
  ]);

  const products = await _attachRelations(rowsRes.rows);
  return { products, total: countRes.rows[0]?.total ?? 0, page, limit };
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

  const [mapped] = await _attachRelations(rows);
  return mapped;
}

async function createProduct(partnerId, data) {
  const { name, priceCents, discountCents, stock } = _validateProductInput(data);

  const category = data.category ?? data.categoryId ?? null;
  const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls.filter(Boolean) : [];
  const variants = Array.isArray(data.variants) ? data.variants : [];
  const visible = data.visible === undefined ? true : Boolean(data.visible);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO products
         (partner_id, category, brand_id, name_en, name_am, name_om,
          description_en, description_am, description_om, delivery_info,
          price_cents, discount_cents, sku, stock, status, is_visible)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PENDING',$15)
       RETURNING *`,
      [
        partnerId, category, data.brandId ?? null,
        name, data.nameAm ?? null, data.nameOm ?? null,
        data.description ?? data.descriptionEn ?? null,
        data.descriptionAm ?? null, data.descriptionOm ?? null,
        data.deliveryInfo ?? null,
        priceCents, discountCents, data.sku ?? null,
        stock ?? 0, visible,
      ],
    );
    const productId = rows[0].id;

    if (imageUrls.length) await _replaceImages(client, productId, imageUrls);
    if (variants.length) await _replaceVariants(client, productId, variants);

    await client.query('COMMIT');
    return getProduct(partnerId, productId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateProduct(partnerId, productId, data) {
  const { name, priceCents, discountCents, stock } = _validateProductInput(data, { partial: true });

  const category = data.category ?? data.categoryId;
  const imageUrls = Array.isArray(data.imageUrls) ? data.imageUrls.filter(Boolean) : null;
  const variants = Array.isArray(data.variants) ? data.variants : null;
  const visible = data.visible === undefined ? null : Boolean(data.visible);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch current product to detect material changes → reset to PENDING
    const { rows: cur } = await client.query(
      `SELECT status, name_en, price_cents FROM products WHERE id = $1 AND partner_id = $2`,
      [productId, partnerId],
    );
    if (cur.length === 0) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    const current = cur[0];

    const materialChange =
      (name && name !== current.name_en) ||
      (priceCents !== null && priceCents !== Number(current.price_cents)) ||
      imageUrls !== null;
    const nextStatus =
      current.status === 'APPROVED' && materialChange ? 'PENDING' : undefined;

    const { rows } = await client.query(
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
           discount_cents = CASE WHEN $11::boolean THEN $12 ELSE discount_cents END,
           sku            = COALESCE($13, sku),
           stock          = COALESCE($14, stock),
           is_visible     = COALESCE($15, is_visible),
           status         = COALESCE($16, status),
           updated_at     = NOW()
       WHERE id = $17 AND partner_id = $18
       RETURNING *`,
      [
        category, data.brandId ?? null,
        name || null, data.nameAm ?? null, data.nameOm ?? null,
        data.description ?? data.descriptionEn ?? null,
        data.descriptionAm ?? null, data.descriptionOm ?? null,
        data.deliveryInfo ?? null,
        priceCents,                                   // $10
        data.discountCents !== undefined || data.discountPrice !== undefined, // $11 hasDiscount
        discountCents === null ? 0 : discountCents,  // $12 (clear → 0)
        data.sku ?? null,                             // $13
        stock,                                        // $14
        visible,                                      // $15
        nextStatus ?? null,                           // $16
        productId, partnerId,                         // $17 $18
      ],
    );
    if (rows.length === 0) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');

    if (imageUrls !== null) await _replaceImages(client, productId, imageUrls);
    if (variants !== null) await _replaceVariants(client, productId, variants);

    await client.query('COMMIT');
    return getProduct(partnerId, productId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
  const [mapped] = await _attachRelations(
    (await pool.query(`SELECT * FROM products WHERE id = $1`, [productId])).rows,
  );
  return { product: mapped || rows[0] };
}

async function uploadImage(partnerId, productId, imageUrl) {
  const { rows: prodRows } = await pool.query(
    `SELECT id FROM products WHERE id = $1 AND partner_id = $2`,
    [productId, partnerId],
  );
  if (prodRows.length === 0) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');

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
