const ACCEPTABLE_ORDER_STATUSES = new Set([
  'CONFIRMED',
  'PROCESSING',
  'PACKED',
]);

function getOfferAcceptanceBlock(order) {
  const status = String(order.status || '').trim().toUpperCase();
  if (!ACCEPTABLE_ORDER_STATUSES.has(status)) {
    return {
      code: 'ORDER_NOT_READY',
      message: 'This order is not confirmed and ready for delivery yet.',
    };
  }

  const paymentStatus = String(
    order.payment_status || order.paymentStatus || 'PENDING',
  ).trim().toUpperCase();

  if (paymentStatus !== 'PAID') {
    return {
      code: 'PAYMENT_NOT_CONFIRMED',
      message: 'Payment must be confirmed before a rider can accept this order.',
    };
  }

  return null;
}

module.exports = { getOfferAcceptanceBlock };
