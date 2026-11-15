const service = require('./seasonal-promotions.service');
const { ok, error, created } = require('../../core/utils/response');

const pick = (body, camel, snake) =>
  (body[camel] !== undefined ? body[camel] : body[snake]);

const cleanText = (v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const parseDate = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const cleanCategory = (v) => {
  if (v === undefined) return undefined;
  const s = String(v || 'all').trim().toLowerCase();
  return service.VALID_CATEGORIES.includes(s) ? s : 'all';
};

const toIdList = (v) =>
  (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && x !== '') : undefined);

// ── POST /api/v1/seasonal-promotions ────────────────────────────────────────
const createPromotion = async (req, res, next) => {
  try {
    const body = req.body || {};
    const title = cleanText(body.title);
    const startsAt = parseDate(pick(body, 'startsAt', 'starts_at'));
    const endsAt = parseDate(pick(body, 'endsAt', 'ends_at'));

    if (!title) return error(res, 'Title is required.', 400, 'MISSING_FIELDS');
    if (title.length > 255) {
      return error(res, 'Title must be 255 characters or fewer.', 400, 'INVALID_TITLE');
    }
    if (!startsAt || !endsAt) {
      return error(res, 'startsAt and endsAt must be valid dates.', 400, 'INVALID_DATE');
    }
    if (endsAt <= startsAt) {
      return error(res, 'End time must be after start time.', 400, 'INVALID_DATE_RANGE');
    }

    const discountRaw = pick(body, 'discountPercent', 'discount_percent');
    let discountPercent = null;
    if (discountRaw !== undefined && discountRaw !== null && discountRaw !== '') {
      discountPercent = Number(discountRaw);
      if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) {
        return error(res, 'discountPercent must be a whole number between 1 and 100.', 400, 'INVALID_DISCOUNT');
      }
    }

    const sortRaw = pick(body, 'sortOrder', 'sort_order');
    const sortOrder = sortRaw === undefined || sortRaw === null || sortRaw === ''
      ? 0
      : parseInt(sortRaw, 10);
    if (!Number.isInteger(sortOrder)) {
      return error(res, 'sortOrder must be a whole number.', 400, 'INVALID_SORT');
    }

    const promo = await service.createPromotion({
      title,
      subtitle: cleanText(pick(body, 'subtitle', 'subtitle')),
      description: cleanText(body.description),
      imageUrl: cleanText(pick(body, 'imageUrl', 'image_url')),
      category: cleanCategory(body.category),
      discountPercent,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      sortOrder,
      productIds: toIdList(pick(body, 'productIds', 'product_ids')),
    });

    created(res, { ...promo, promotion: promo });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/seasonal-promotions/active  (public, for customer app) ──────
const getActivePromotions = async (_req, res, next) => {
  try {
    const promotions = await service.getActivePromotions();
    ok(res, { promotions, count: promotions.length });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/seasonal-promotions/:id/products  (public, customer app) ────
const getPromotionProducts = async (req, res, next) => {
  try {
    const products = await service.getPromotionProducts(req.params.id);
    ok(res, { products, count: products.length });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/seasonal-promotions  (admin list) ───────────────────────────
const getAllPromotions = async (req, res, next) => {
  try {
    const includeExpired = req.query.includeExpired !== 'false';
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const promotions = await service.getAllPromotions({ includeExpired, limit, offset });
    ok(res, { promotions, limit, offset, count: promotions.length });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/seasonal-promotions/:id ─────────────────────────────────────
const getPromotionById = async (req, res, next) => {
  try {
    const promo = await service.getPromotionById(req.params.id);
    ok(res, { ...promo, promotion: promo });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/v1/seasonal-promotions/:id ───────────────────────────────────
const updatePromotion = async (req, res, next) => {
  try {
    const body = req.body || {};
    const updates = {
      title: cleanText(body.title),
      subtitle: cleanText(body.subtitle),
      description: cleanText(body.description),
      imageUrl: cleanText(pick(body, 'imageUrl', 'image_url')),
      category: cleanCategory(body.category),
      discountPercent: pick(body, 'discountPercent', 'discount_percent'),
      startsAt: pick(body, 'startsAt', 'starts_at'),
      endsAt: pick(body, 'endsAt', 'ends_at'),
      sortOrder: pick(body, 'sortOrder', 'sort_order'),
      isActive: pick(body, 'isActive', 'is_active'),
      productIds: toIdList(pick(body, 'productIds', 'product_ids')),
    };

    if (updates.discountPercent !== undefined && updates.discountPercent !== null) {
      const n = Number(updates.discountPercent);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        return error(res, 'discountPercent must be a whole number between 1 and 100.', 400, 'INVALID_DISCOUNT');
      }
      updates.discountPercent = n;
    }
    for (const k of ['startsAt', 'endsAt']) {
      if (updates[k] !== undefined && updates[k] !== null) {
        const d = parseDate(updates[k]);
        if (!d) return error(res, `${k} must be a valid date.`, 400, 'INVALID_DATE');
        updates[k] = d.toISOString();
      }
    }
    if (updates.sortOrder !== undefined && updates.sortOrder !== null) {
      const n = parseInt(updates.sortOrder, 10);
      if (!Number.isInteger(n)) {
        return error(res, 'sortOrder must be a whole number.', 400, 'INVALID_SORT');
      }
      updates.sortOrder = n;
    }
    if (updates.isActive !== undefined && typeof updates.isActive !== 'boolean') {
      updates.isActive = updates.isActive === 'true' || updates.isActive === 1;
    }

    const promo = await service.updatePromotion(req.params.id, updates);
    ok(res, { message: 'Promotion updated successfully', promotion: promo });
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/v1/seasonal-promotions/:id ──────────────────────────────────
const deletePromotion = async (req, res, next) => {
  try {
    await service.deletePromotion(req.params.id);
    ok(res, { message: 'Promotion deleted successfully' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createPromotion,
  getActivePromotions,
  getPromotionProducts,
  getAllPromotions,
  getPromotionById,
  updatePromotion,
  deletePromotion,
};
