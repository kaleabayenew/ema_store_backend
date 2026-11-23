process.env.JWT_SECRET = 'test-only-jwt-secret-with-more-than-32-characters';
process.env.OTP_HMAC_SECRET = 'test-only-otp-secret-with-more-than-32-characters';
process.env.NODE_ENV = 'test';

const { signAccessToken, verifyToken } = require('../../src/core/utils/jwt');

const test = require('node:test');
const assert = require('node:assert/strict');

test('access JWT signs and verifies an approved claim set', () => {
    const token = signAccessToken({
      id: 'customer-1',
      phone: '+251911000000',
      role: 'CUSTOMER',
      unrelated: 'must-not-be-included',
    });

    const claims = verifyToken(token);

    assert.equal(claims.id, 'customer-1');
    assert.equal(claims.phone, '+251911000000');
    assert.equal(claims.role, 'CUSTOMER');
    assert.equal(claims.unrelated, undefined);
});

test('access JWT rejects a token signed with a different secret', () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { id: 'customer-1', role: 'CUSTOMER' },
      'a-different-secret-that-is-long-enough-123',
      { algorithm: 'HS256' },
    );

    assert.throws(() => verifyToken(token));
});
