const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePaymentMethod } = require('../../../src/features/orders/orders.service');

test('accepts supported order payment methods', () => {
  for (const method of [
    'Telebirr',
    'CBE',
    'CBE Birr',
    'BALANCE',
    'WALLET_BALANCE',
    'COINS',
  ]) {
    assert.doesNotThrow(() => validatePaymentMethod(method));
  }
});

test('rejects unsupported payment methods with a regular validation error', () => {
  for (const method of ['Chapa', '', null]) {
    assert.throws(
      () => validatePaymentMethod(method),
      (error) =>
        error.status === 400 &&
        error.code === 'INVALID_PAYMENT_METHOD' &&
        error.message === 'Invalid payment method',
    );
  }
});
