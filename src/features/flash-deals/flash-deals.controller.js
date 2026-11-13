const service = require('./flash-deals.service');
const { ok, error, created } = require('../../core/utils/response');

// Accept both camelCase and snake_case so the admin panel and any other client work.
const pick = (body, camel, snake) => (body[camel] !== undefined ? body[camel] : body[snake]);

const toIdList = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && x !== '') : undefined);

const parseDate = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const cleanText = (v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// ── POST /api/v1/flash-deals
const createFlashDeal = async (req, res, next) => {
  try {
    const body = req.body || {};
    const title = cleanText(body.title);
    const description = cleanText(body.description);
    const imageUrl = cleanText(pick(body, 'imageUrl', 'image_url'));
    const discountRaw = pick(body, 'discountPercent', 'discount_percent');
    const startsAtRaw = pick(body, 'startsAt', 'starts_at');
    const endsAtRaw = pick(body, 'endsAt', 'ends_at');
    const productIds = toIdList(pick(body, 'productIds', 'product_ids'));
    const categoryIds = toIdList(pick(body, 'categoryIds', 'category_ids'));

    if (!title || discountRaw === undefined || discountRaw === null || discountRaw === '' || !startsAtRaw || !endsAtRaw) {
      return error(res, 'title, discountPercent, startsAt, and endsAt are required.', 400, 'MISSING_FIELDS');
    }
    if (title.length > 255) {
      return error(res, 'Title must be 255 characters or fewer.', 400, 'INVALID_TITLE');
    }

    const discountPercent = Number(discountRaw);
    if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) {
      return error(res, 'discountPercent must be a whole number between 1 and 100.', 400, 'INVALID_DISCOUNT');
    }

    const startsAt = parseDate(startsAtRaw);
    const endsAt = parseDate(endsAtRaw);
    if (!startsAt || !endsAt) {
      return error(res, 'startsAt and endsAt must be valid dates.', 400, 'INVALID_DATE');
    }
    if (endsAt <= startsAt) {
      return error(res, 'End time must be after start time.', 400, 'INVALID_DATE_RANGE');
    }

    const deal = await service.createFlashDeal({
      title,
      description,
      discountPercent,
      productIds,
      categoryIds,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      imageUrl,
      createdBy: req.user?.id || null,
    });

    created(res, { ...deal, deal });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/flash-deals  (admin list — includes paused & expired deals)
const getAllFlashDeals = async (req, res, next) => {
  try {
    const includeExpired = req.query.includeExpired !== 'false';
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
    const offset = parseInt(req.query.offset, 10) || 0;

    const deals = await service.getAllFlashDeals({ includeExpired, limit, offset });
    ok(res, { deals, limit, offset, count: deals.length });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/flash-deals/active
const getActiveFlashDeals = async (_req, res, next) => {
  try {
    const deals = await service.getActiveFlashDeals();
    ok(res, { deals, count: deals.length });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/flash-deals/:id
const getFlashDealById = async (req, res, next) => {
  try {
    const deal = await service.getFlashDealById(req.params.id);
    ok(res, { ...deal, deal });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/flash-deals/:id/products
const getFlashDealProducts = async (req, res, next) => {
  try {
    const products = await service.getFlashDealProducts(req.params.id);
    ok(res, { products, count: products.length });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/v1/flash-deals/:id
const updateFlashDeal = async (req, res, next) => {
  try {
    const body = req.body || {};
    const updates = {
      title: cleanText(body.title),
      description: cleanText(body.description),
      discountPercent: pick(body, 'discountPercent', 'discount_percent'),
      startsAt: pick(body, 'startsAt', 'starts_at'),
      endsAt: pick(body, 'endsAt', 'ends_at'),
      imageUrl: cleanText(pick(body, 'imageUrl', 'image_url')),
      isActive: pick(body, 'isActive', 'is_active'),
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
    if (updates.isActive !== undefined && typeof updates.isActive !== 'boolean') {
      updates.isActive = updates.isActive === 'true' || updates.isActive === 1;
    }

    const deal = await service.updateFlashDeal(req.params.id, updates);
    ok(res, { message: 'Flash deal updated successfully', deal });
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/v1/flash-deals/:id
const deleteFlashDeal = async (req, res, next) => {
  try {
    await service.deleteFlashDeal(req.params.id);
    ok(res, { message: 'Flash deal deleted successfully' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createFlashDeal,
  getAllFlashDeals,
  getActiveFlashDeals,
  getFlashDealById,
  getFlashDealProducts,
  updateFlashDeal,
  deleteFlashDeal,
};