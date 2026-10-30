require('dotenv').config({ quiet: true });

const port = Number.parseInt(process.env.PORT || '3000', 10);

// Allowed CORS origins — includes Flutter web, Android emulator, iOS simulator
const allowedOrigins = [
  process.env.CUSTOMER_APP_URL,
  process.env.CUSTOMER_APP_URL_ANDROID,
  process.env.CUSTOMER_APP_URL_IOS,
  process.env.CUSTOMER_APP_URL_WEB,
  // Allow local development servers
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://localhost:54321',
  'http://10.0.2.2:3000',
  // 127.0.0.1 is treated as a distinct origin from localhost by browsers/Flutter web
  'http://127.0.0.1:3000',
].filter(Boolean); // remove any undefined entries

module.exports = Object.freeze({
  port:           Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 3000,
  nodeEnv:        process.env.NODE_ENV || 'development',
  databaseUrl:    process.env.DATABASE_URL || '',
  jwtSecret:      process.env.JWT_SECRET || 'changeme',
  jwtExpiresIn:   process.env.JWT_EXPIRES_IN || '7d',
  allowedOrigins,
});
