const express = require('express');
const cors    = require('cors');

const { allowedOrigins, nodeEnv } = require('./core/config');
const { pool }                    = require('./core/config/database');
const { errorHandler }            = require('./core/middleware/error_handler');

// Auto-migrate database on startup
async function autoMigrate() {
  try {
    console.log('[Migration] Starting auto-migration...');
    
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone VARCHAR(20) UNIQUE NOT NULL,
        full_name VARCHAR(255),
        password VARCHAR(255),
        role VARCHAR(50) DEFAULT 'CUSTOMER',
        is_verified BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        otp_code VARCHAR(10),
        otp_expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Users table');

    // Add is_active column if it doesn't exist
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
    } catch (e) {
      // Column might already exist
    }

    // Add email column if it doesn't exist
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE`);
    } catch (e) {
      // Column might already exist
    }

    // Add password_hash column if it doesn't exist (migrate from password)
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`);
      await pool.query(`UPDATE users SET password_hash = password WHERE password_hash IS NULL AND password IS NOT NULL`);
    } catch (e) {
      // Column might already exist
    }

    // Add password_plain column for admin visibility (stored alongside the hash)
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_plain VARCHAR(255)`);
    } catch (e) {
      // Column might already exist
    }

    // Create products table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        partner_id UUID REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        price DECIMAL(10, 2) NOT NULL,
        old_price DECIMAL(10, 2),
        stock_quantity INTEGER DEFAULT 0,
        image_url TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Products table');

    // Add old_price column if it doesn't exist
    try {
      await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS old_price DECIMAL(10, 2)`);
    } catch (e) {
      // Column might already exist
    }

    // Create product_images table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL,
        is_primary BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Product images table');

    // Create categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        image_url TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Categories table');

    // Create flash_deals table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flash_deals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        discount_percentage DECIMAL(5, 2) NOT NULL,
        starts_at TIMESTAMP NOT NULL,
        ends_at TIMESTAMP NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Flash deals table');

    // Add starts_at column if it doesn't exist (migrate from start_time)
    try {
      await pool.query(`ALTER TABLE flash_deals ADD COLUMN IF NOT EXISTS starts_at TIMESTAMP`);
      await pool.query(`UPDATE flash_deals SET starts_at = start_time WHERE starts_at IS NULL AND start_time IS NOT NULL`);
    } catch (e) {
      // Column might already exist
    }

    // Add ends_at column if it doesn't exist (migrate from end_time)
    try {
      await pool.query(`ALTER TABLE flash_deals ADD COLUMN IF NOT EXISTS ends_at TIMESTAMP`);
      await pool.query(`UPDATE flash_deals SET ends_at = end_time WHERE ends_at IS NULL AND end_time IS NOT NULL`);
    } catch (e) {
      // Column might already exist
    }

    // Create orders table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        total_amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'PENDING',
        shipping_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Orders table');

    // Create order_items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id),
        quantity INTEGER NOT NULL,
        price_at_order DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Order items table');

    // Create notifications table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        body TEXT,
        type VARCHAR(50),
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Notifications table');

    // Create fcm_tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fcm_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, token)
      );
    `);
    console.log('[Migration] ✓ FCM tokens table');

    // Create otp_codes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone VARCHAR(20) NOT NULL,
        code VARCHAR(10) NOT NULL,
        type VARCHAR(20) DEFAULT 'REGISTER',
        expires_at TIMESTAMP NOT NULL,
        is_used BOOLEAN DEFAULT false,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ OTP codes table');

    // Create customer_user table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_user (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        full_name VARCHAR(255),
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Customer user table');

    // Create admin_user table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_user (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        admin_role VARCHAR(50),
        full_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Admin user table');

    // Create telegram_chat_ids table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_chat_ids (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone VARCHAR(20) UNIQUE NOT NULL,
        chat_id BIGINT NOT NULL,
        username VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[Migration] ✓ Telegram chat IDs table');

    console.log('[Migration] ✅ Auto-migration completed successfully!');
  } catch (error) {
    console.error('[Migration] ❌ Auto-migration failed:', error.message);
    // Don't exit - let the server start anyway
  }
}

// Run auto-migration before starting the server
autoMigrate();

// Initialise Firebase Admin SDK (gracefully skipped if key file is absent)
try {
  const { initFirebase } = require('./core/config/firebase');
  initFirebase();
} catch (e) {
  console.warn('[App] Firebase initialization skipped:', e.message);
}

// ── Feature routers ────────────────────────────────────────────────────────────
const authRouter = require('./features/auth/auth.router');
const notificationsRouter = require('./features/notifications/notifications.router');
const flashDealsRouter = require('./features/flash-deals/flash-deals.router');
const productsRouter = require('./features/products/products.router');
const uploadRouter = require('./features/upload/upload.router');
const telegramRouter = require('./features/telegram/telegram.routes');
const referralRouter = require('./features/referral/referral.routes');
const specialOffersRouter = require('./features/special-offers/special-offers.router');
const customersRouter     = require('./features/customers/customers.router');

const app = express();

app.disable('x-powered-by');

// ── Request logging ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// ── CORS ───────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow localhost for web development (any port)
    if (origin && (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1'))) {
      return callback(null, true);
    }
    // For now, allow all origins in production too (for mobile/web development)
    // TODO: Restrict in production once frontend is deployed
    return callback(null, true);
  },
  methods:             ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:      ['Content-Type', 'Authorization'],
  exposedHeaders:      ['X-Total-Count'],
  credentials:         true,
  optionsSuccessStatus: 200,
}));

app.use(express.json());

// ── Static files (uploads) ───────────────────────────────────────────────────────
app.use('/uploads', express.static('public/uploads'));

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', environment: nodeEnv, database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', database: 'not connected' });
  }
});

// ── API v1 ─────────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/flash-deals', flashDealsRouter);
app.use('/api/v1/products', productsRouter);
app.use('/api/v1/upload', uploadRouter);
app.use('/api/v1/telegram', telegramRouter);
app.use('/api/v1/referral', referralRouter);
app.use('/api/v1/special-offers', specialOffersRouter);
app.use('/api/v1/customers',     customersRouter);

// ── Root ───────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    message: 'Ema Store Backend API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      api: '/api/v1'
    }
  });
});

// ── 404 ────────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(errorHandler);

module.exports = app;
