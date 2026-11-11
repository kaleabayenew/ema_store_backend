const { AppError } = require('../errors/app_error');

const isProduction = process.env.NODE_ENV === 'production';
const isPgError = (code) => typeof code === 'string' && /^[0-9][0-9A-Z]{4}$/.test(code);

const fail = (res, status, code, message, req) => {
  res.set('Cache-Control', 'no-store');
  const body = { success: false, code, message };
  if (req && req.id) body.requestId = req.id;
  return res.status(status).json(body);
};

/**
 * Central Express error-handling middleware.
 * Must be the LAST app.use() call in app.js.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  // Known operational error
  if (err instanceof AppError) {
    return fail(res, err.status, err.code, err.message, req);
  }

  // Malformed JSON body
  if (err.type === 'entity.parse.failed') {
    return fail(res, 400, 'INVALID_JSON', 'Request body is not valid JSON.', req);
  }

  // Body larger than the limit
  if (err.type === 'entity.too.large') {
    return fail(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.', req);
  }

  // Postgres unique-violation (e.g. duplicate phone) — generic message only
  if (err.code === '23505') {
    return fail(res, 409, 'DUPLICATE', 'A record with those details already exists.', req);
  }

  // Any other Postgres error — never leak err.message / err.detail
  if (isPgError(err.code)) {
    console.error('[error] pg', { code: err.code, path: req?.path, method: req?.method });
    return fail(res, 500, 'INTERNAL_ERROR', 'Something went wrong.', req);
  }

  // JWT errors from the auth middleware
  if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
    return fail(res, 401, 'INVALID_TOKEN', 'Invalid or malformed token.', req);
  }
  if (err.name === 'TokenExpiredError') {
    return fail(res, 401, 'TOKEN_EXPIRED', 'Session expired. Please sign in again.', req);
  }

  // CORS rejection from the cors middleware — an expected denial, not a
  // server fault. Return 403 quietly so logs stay clean.
  if (err.message === 'Origin not allowed' || err.message === 'Not allowed by CORS') {
    return fail(res, 403, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed.', req);
  }

  // Unknown / programmer error — never leak internals in production
  console.error('[error]', {
    code: err.code,
    name: err.name,
    path: req?.path,
    method: req?.method,
    ...(isProduction ? {} : { stack: err.stack }),
  });

  return fail(
    res,
    500,
    'INTERNAL_ERROR',
    isProduction ? 'Something went wrong.' : err.message,
    req,
  );
};

module.exports = { errorHandler };
