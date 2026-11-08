// src/features/payment-methods/payment-methods.service.js

const { pool } = require('../../core/config/database');

class PaymentMethodsService {
  // Get all active payment methods
  async getActivePaymentMethods() {
    const query = `
      SELECT
        id,
        name,
        code,
        icon_url,
        display_order
      FROM payment_methods
      WHERE is_active = true
      ORDER BY display_order ASC, name ASC
    `;

    const result = await pool.query(query);

    return {
      success: true,
      paymentMethods: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        code: row.code,
        iconUrl: row.icon_url,
        displayOrder: row.display_order
      }))
    };
  }

  // Get payment method by code
  async getPaymentMethodByCode(code) {
    const query = `
      SELECT
        id,
        name,
        code,
        icon_url,
        display_order
      FROM payment_methods
      WHERE code = $1 AND is_active = true
    `;

    const result = await pool.query(query, [code]);

    if (result.rows.length === 0) {
      throw new Error('Payment method not found');
    }

    const row = result.rows[0];
    return {
      success: true,
      paymentMethod: {
        id: row.id,
        name: row.name,
        code: row.code,
        iconUrl: row.icon_url,
        displayOrder: row.display_order
      }
    };
  }
}

module.exports = new PaymentMethodsService();
