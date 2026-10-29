/**
 * Consistent JSON response helpers.
 */

/** 2xx success */
const ok = (res, data = {}, status = 200) =>
  res.status(status).json({ success: true, ...data });

/** 201 created */
const created = (res, data = {}) => ok(res, data, 201);

/** 4xx / 5xx error */
const error = (res, message, status = 400, code = 'ERROR') =>
  res.status(status).json({ success: false, code, message });

module.exports = { ok, created, error };
