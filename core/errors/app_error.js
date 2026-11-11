/**
 * AppError — structured operational error with HTTP status.
 * Throw this anywhere in services/controllers; the error handler
 * serialises it into a consistent JSON response.
 */
class AppError extends Error {
  /**
   * @param {string} message   Human-readable message
   * @param {number} status    HTTP status code (default 400)
   * @param {string} [code]    Machine-readable error code, e.g. "PHONE_TAKEN"
   */
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.name   = 'AppError';
    this.status = status;
    this.code   = code;
  }
}

module.exports = { AppError };
