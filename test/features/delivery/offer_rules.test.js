const test = require('node:test');
const assert = require('node:assert/strict');
const { getOfferAcceptanceBlock } = require('../../../src/features/delivery/offer_rules');

test('only confirmed, processing, or packed orders can be accepted', () => {
  assert.equal(
    getOfferAcceptanceBlock({
      status: 'PENDING',
      payment_status: 'PAID',
      payment_method: 'Telebirr',
    }).code,
    'ORDER_NOT_READY',
  );
});

test('orders require confirmed payment before acceptance', () => {
  assert.equal(
    getOfferAcceptanceBlock({
      status: 'CONFIRMED',
      payment_status: 'PENDING',
      payment_method: 'Telebirr',
    }).code,
    'PAYMENT_NOT_CONFIRMED',
  );
});

test('only paid orders are acceptable after confirmation', () => {
  assert.equal(
    getOfferAcceptanceBlock({
      status: 'PACKED',
      payment_status: 'PAID',
      payment_method: 'Telebirr',
    }),
    null,
  );
  assert.equal(
    getOfferAcceptanceBlock({
      status: 'CONFIRMED',
      payment_status: 'PENDING',
      payment_method: 'Telebirr',
    }).code,
    'PAYMENT_NOT_CONFIRMED',
  );
});
