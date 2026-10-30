const { AppError } = require('../errors/app_error');

/**
 * Central Express error-handling middleware.
 * Must be the LAST app.use() call in app.js.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, _req, res, _next) => {
  // Known operational error
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      code:    err.code,
      message: err.message,
    });
  }

  // Postgres unique-violation (e.g. duplicate phone)
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      code:    'DUPLICATE',
      message: 'A record with those details already exists.',
    });
  }

  // JWT errors from the auth middleware
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      code:    'INVALID_TOKEN',
      message: 'Invalid or malformed token.',
    });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      code:    'TOKEN_EXPIRED',
      message: 'Session expired. Please sign in again.',
    });
  }

  // Unknown / programmer error — hide details in production
  const isDev = process.env.NODE_ENV !== 'production';
  console.error('[error]', err);
  res.status(500).json({
    success: false,
    code:    'INTERNAL_ERROR',
    message: isDev ? err.message : 'Something went wrong.',
    ...(isDev && { stack: err.stack }),
  });
};

module.exports = { errorHandler };
