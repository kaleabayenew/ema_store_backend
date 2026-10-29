const express = require('express');
const cors    = require('cors');

const { allowedOrigins, nodeEnv } = require('./core/config');
const { pool }                    = require('./core/config/database');
const { errorHandler }            = require('./core/middleware/error_handler');

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

const app = express();

app.disable('x-powered-by');

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
