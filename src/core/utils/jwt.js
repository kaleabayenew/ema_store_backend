const jwt = require('jsonwebtoken');
const { jwtSecret, jwtExpiresIn } = require('../config');

/**
 * Sign a JWT for a user.
 * @param {{ id: string, phone?: string, email?: string, role: string, adminRole?: string }} payload
 * @returns {string} signed token
 */
const signToken = (payload) =>
  jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn });

/**
 * Verify and decode a JWT.
 * Throws JsonWebTokenError / TokenExpiredError on failure.
 * @param {string} token
 * @returns {{ id: string, phone?: string, email?: string, role: string, adminRole?: string }}
 */
const verifyToken = (token) => jwt.verify(token, jwtSecret);

module.exports = { signToken, verifyToken };
