const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

const APPS = ['customer', 'partner'];

// Default page catalog seeded into app_page_controls. Keys match the Flutter
// GoRouter paths so apps can look up controls by route.
const PAGE_SEEDS = {
  customer: [
    ['/', 'Home'],
    ['/home', 'Home Feed'],
    ['/search', 'Search'],
    ['/category', 'Categories'],
    ['/products', 'Products'],
    ['/products/:id', 'Product Details'],
    ['/new-arrivals', 'New Arrivals'],
    ['/top-rated', 'Top Rated'],
    ['/recently-viewed', 'Recently Viewed'],
    ['/seasonal-promotions', 'Seasonal Promotions'],
    ['/special-offers', 'Special Offers'],
    ['/reviews', 'Reviews'],
    ['/verified-sellers', 'Verified Sellers'],
    ['/luxury', 'Luxury'],
    ['/ema-bid', 'EMA Bid'],
    ['/bids', 'My Bids'],
    ['/coupons', 'Coupons & Spin Wheel'],
    ['/wishlist', 'Wishlist'],
    ['/cart', 'Cart'],
    ['/checkout', 'Checkout'],
    ['/order-success', 'Order Success'],
    ['/more', 'More'],
    ['/profile', 'Profile'],
    ['/my-profile', 'My Profile'],
    ['/wallet', 'Wallet'],
    ['/history', 'History'],
    ['/orders', 'Orders'],
    ['/notifications', 'Notifications'],
    ['/vip', 'VIP'],
    ['/support', 'Support'],
    ['/support/history', 'Support History'],
    ['/language', 'Language'],
    ['/feedback', 'Feedback'],
    ['/about', 'About'],
  ],
  partner: [
    ['/dashboard', 'Dashboard'],
    ['/products', 'Products'],
    ['/orders', 'Orders'],
    ['/inventory', 'Inventory'],
    ['/earnings', 'Earnings'],
    ['/wallet', 'Wallet'],
    ['/more', 'More'],
    ['/reviews', 'Reviews'],
    ['/promotions', 'Promotions'],
    ['/notifications', 'Notifications'],
    ['/support', 'Support'],
    ['/support/chat', 'Support Chat'],
    ['/profile', 'Shop Profile'],
    ['/language', 'Language'],
  ],
};

function assertApp(app) {
  if (!APPS.includes(app)) {
    throw new AppError('Invalid app. Use "customer" or "partner".', 400, 'INVALID_APP');
  }
}

// Idempotent seed — safe to call on every list.
async function ensureSeeded(client = pool) {
  for (const [app, pages] of Object.entries(PAGE_SEEDS)) {
    for (let i = 0; i < pages.length; i++) {
      const [pageKey, title] = pages[i];
      await client.query(
        `INSERT INTO app_page_controls (app, page_key, title, sort_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (app, page_key) DO NOTHING`,
        [app, pageKey, title, i + 1]
      );
    }
  }
}

async function listPages(app) {
  assertApp(app);
  await ensureSeeded();
  const { rows } = await pool.query(
    `SELECT id, app, page_key, title, is_hidden, is_locked, sort_order, updated_at
     FROM app_page_controls
     WHERE app = $1
     ORDER BY sort_order ASC, page_key ASC`,
    [app]
  );
  return rows.map(mapRow);
}

async function setPageControl(app, pageKey, { isHidden, isLocked }) {
  assertApp(app);
  if (typeof pageKey !== 'string' || !pageKey.startsWith('/')) {
    throw new AppError('Invalid page key', 400, 'INVALID_PAGE_KEY');
  }
  const hidden = isHidden === undefined ? null : Boolean(isHidden);
  const locked = isLocked === undefined ? null : Boolean(isLocked);
  if (hidden === null && locked === null) {
    throw new AppError('Provide isHidden and/or isLocked', 400, 'NOTHING_TO_UPDATE');
  }

  const { rows } = await pool.query(
    `INSERT INTO app_page_controls (app, page_key, title, is_hidden, is_locked, sort_order)
     VALUES ($1, $2, $3, COALESCE($4, false), COALESCE($5, false), 9999)
     ON CONFLICT (app, page_key) DO UPDATE SET
       is_hidden = COALESCE($4, app_page_controls.is_hidden),
       is_locked = COALESCE($5, app_page_controls.is_locked),
       updated_at = NOW()
     RETURNING id, app, page_key, title, is_hidden, is_locked, sort_order, updated_at`,
    [app, pageKey, pageKey, hidden, locked]
  );
  return mapRow(rows[0]);
}

// Compact state map for the Flutter apps to enforce hide/lock.
async function getState(app) {
  assertApp(app);
  await ensureSeeded();
  const { rows } = await pool.query(
    `SELECT page_key, is_hidden, is_locked FROM app_page_controls WHERE app = $1`,
    [app]
  );
  const pages = {};
  for (const r of rows) {
    pages[r.page_key] = { hidden: r.is_hidden, locked: r.is_locked };
  }
  const maintenance = await getMaintenance(app);
  return { app, pages, maintenance };
}

// ── Maintenance mode ─────────────────────────────────────────────────────────

async function getMaintenance(app) {
  assertApp(app);
  const { rows } = await pool.query(
    'SELECT enabled, message, updated_at FROM app_maintenance WHERE app = $1',
    [app]
  );
  const r = rows[0];
  return {
    enabled: r?.enabled === true,
    message: r?.message || null,
    updatedAt: r?.updated_at || null,
  };
}

async function setMaintenance(app, { enabled, message }) {
  assertApp(app);
  const isEnabled = enabled === undefined ? null : Boolean(enabled);
  const msg = message === undefined ? null : (typeof message === 'string' ? message.trim().slice(0, 300) : null);
  if (isEnabled === null && msg === null) {
    throw new AppError('Provide enabled and/or message', 400, 'NOTHING_TO_UPDATE');
  }
  const { rows } = await pool.query(
    `INSERT INTO app_maintenance (app, enabled, message, updated_at)
     VALUES ($1, COALESCE($2, false), $3, NOW())
     ON CONFLICT (app) DO UPDATE SET
       enabled = COALESCE($2, app_maintenance.enabled),
       message = COALESCE($3, app_maintenance.message),
       updated_at = NOW()
     RETURNING enabled, message, updated_at`,
    [app, isEnabled, msg === '' ? null : msg]
  );
  const r = rows[0];
  return { enabled: r.enabled, message: r.message, updatedAt: r.updated_at };
}

function mapRow(r) {
  return {
    id: r.id,
    app: r.app,
    pageKey: r.page_key,
    title: r.title,
    isHidden: r.is_hidden,
    isLocked: r.is_locked,
    sortOrder: r.sort_order,
    updatedAt: r.updated_at,
  };
}

module.exports = { listPages, setPageControl, getState, getMaintenance, setMaintenance, APPS };
