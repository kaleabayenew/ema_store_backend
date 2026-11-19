const { ok, created, error } = require('../../core/utils/response');
const { pool } = require('../../core/config/database');

// ── Schema ──────────────────────────────────────────────────────────────────
// payment_banners is shared by every app surface; `placement` decides which
// app receives the banner ('payment' = customer app payment banner,
// 'ride' = Ema Ride rider app home banner).
let schemaPromise = null;
function ensureBannerSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(
        `ALTER TABLE payment_banners
           ADD COLUMN IF NOT EXISTS placement VARCHAR(20) NOT NULL DEFAULT 'payment'`,
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_payment_banners_placement
           ON payment_banners(placement) WHERE is_active = true`,
      );
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

const isValidWindow = `
  AND (valid_from IS NULL OR valid_from <= NOW())
  AND (valid_until IS NULL OR valid_until > NOW())`;

// ── Public: customer app banners ────────────────────────────────────────────

// GET /api/v1/banners - Get all active payment banners for customer app
const getActiveBanners = async (req, res, next) => {
  try {
    await ensureBannerSchema();
    const { rows } = await pool.query(`
      SELECT * FROM payment_banners
      WHERE is_active = true AND placement = 'payment'
      ORDER BY created_at DESC
    `);

    ok(res, { banners: rows });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/banners/payment - Get active payment banner
const getPaymentBanner = async (req, res, next) => {
  try {
    await ensureBannerSchema();
    const { rows } = await pool.query(`
      SELECT * FROM payment_banners
      WHERE is_active = true AND placement = 'payment'
      ${isValidWindow}
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (rows.length === 0) {
      return ok(res, { banner: null });
    }

    ok(res, { banner: rows[0] });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/banners/ride - Active banners for the Ema Ride rider app.
const getRideBanners = async (req, res, next) => {
  try {
    await ensureBannerSchema();
    const { rows } = await pool.query(`
      SELECT id, title, description, image_url, redirect_url, created_at
      FROM payment_banners
      WHERE is_active = true AND placement = 'ride'
      ${isValidWindow}
      ORDER BY created_at DESC
      LIMIT 10
    `);

    ok(res, { banners: rows });
  } catch (err) {
    next(err);
  }
};

// ── Admin helpers ───────────────────────────────────────────────────────────

async function listAllBanners(placement) {
  await ensureBannerSchema();
  const { rows } = await pool.query(
    `SELECT * FROM payment_banners
     WHERE placement = $1
     ORDER BY created_at DESC`,
    [placement],
  );
  return rows;
}

async function createBanner(placement, body) {
  await ensureBannerSchema();
  const { title, description, image_url, valid_from, valid_until, redirect_url } = body;
  const { rows } = await pool.query(
    `INSERT INTO payment_banners
       (title, description, image_url, valid_from, valid_until, redirect_url, is_active, placement)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7)
     RETURNING *`,
    [title, description, image_url, valid_from, valid_until, redirect_url, placement],
  );
  return rows[0];
}

async function updateBanner(placement, id, body) {
  await ensureBannerSchema();
  const { title, description, image_url, valid_from, valid_until, redirect_url, is_active } = body;
  const { rows } = await pool.query(
    `UPDATE payment_banners
     SET title = COALESCE($1, title),
         description = COALESCE($2, description),
         image_url = COALESCE($3, image_url),
         valid_from = COALESCE($4, valid_from),
         valid_until = COALESCE($5, valid_until),
         redirect_url = COALESCE($6, redirect_url),
         is_active = COALESCE($7, is_active),
         updated_at = NOW()
     WHERE id = $8 AND placement = $9
     RETURNING *`,
    [title, description, image_url, valid_from, valid_until, redirect_url, is_active, id, placement],
  );
  return rows[0] || null;
}

async function deleteBanner(placement, id) {
  await ensureBannerSchema();
  await pool.query(
    `DELETE FROM payment_banners WHERE id = $1 AND placement = $2`,
    [id, placement],
  );
}

// ── Admin: payment banners ──────────────────────────────────────────────────

// GET /api/v1/banners/payment/all - Get all payment banners (admin)
const getAllPaymentBanners = async (req, res, next) => {
  try {
    ok(res, { banners: await listAllBanners('payment') });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/banners/payment - Create payment banner (admin)
const createPaymentBanner = async (req, res, next) => {
  try {
    created(res, await createBanner('payment', req.body || {}));
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/banners/payment/:id - Update payment banner (admin)
const updatePaymentBanner = async (req, res, next) => {
  try {
    const banner = await updateBanner('payment', req.params.id, req.body || {});
    if (!banner) {
      return error(res, 'Banner not found', 404, 'NOT_FOUND');
    }
    ok(res, { banner });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/banners/payment/:id - Delete payment banner (admin)
const deletePaymentBanner = async (req, res, next) => {
  try {
    await deleteBanner('payment', req.params.id);
    ok(res, { message: 'Banner deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// ── Admin: ride app banners ─────────────────────────────────────────────────

// GET /api/v1/banners/ride/all - All ride banners (admin)
const getAllRideBanners = async (req, res, next) => {
  try {
    ok(res, { banners: await listAllBanners('ride') });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/banners/ride - Create ride banner (admin)
const createRideBanner = async (req, res, next) => {
  try {
    created(res, await createBanner('ride', req.body || {}));
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/banners/ride/:id - Update ride banner (admin)
const updateRideBanner = async (req, res, next) => {
  try {
    const banner = await updateBanner('ride', req.params.id, req.body || {});
    if (!banner) {
      return error(res, 'Banner not found', 404, 'NOT_FOUND');
    }
    ok(res, { banner });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/banners/ride/:id - Delete ride banner (admin)
const deleteRideBanner = async (req, res, next) => {
  try {
    await deleteBanner('ride', req.params.id);
    ok(res, { message: 'Banner deleted successfully' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getActiveBanners,
  getPaymentBanner,
  getRideBanners,
  createPaymentBanner,
  getAllPaymentBanners,
  updatePaymentBanner,
  deletePaymentBanner,
  createRideBanner,
  getAllRideBanners,
  updateRideBanner,
  deleteRideBanner,
};
