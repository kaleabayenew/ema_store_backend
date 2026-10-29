require('dotenv').config();

const port = process.env.PORT || 3000;
const nodeEnv = process.env.NODE_ENV || 'development';

// CORS allowed origins
const allowedOrigins = [
  process.env.CUSTOMER_APP_URL || 'http://localhost:54321',
  process.env.CUSTOMER_APP_URL_ANDROID || 'http://10.0.2.2:3000',
  process.env.CUSTOMER_APP_URL_IOS || 'http://localhost:3000',
  process.env.CUSTOMER_APP_URL_WEB || 'http://127.0.0.1:3000',
].filter(Boolean);

module.exports = {
  port,
  nodeEnv,
  allowedOrigins,
};