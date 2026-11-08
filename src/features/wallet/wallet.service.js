// src/features/wallet/wallet.service.js

const { pool } = require('../../core/config/database');

class WalletService {
  // Get user's transactions with pagination
  async getTransactions(userId, { limit = 20, offset = 0, type, status, startDate, endDate }) {
    let query = `
      SELECT
        id,
        user_id,
        title,
        description,
        amount,
        type,
        status,
        metadata,
        created_at
      FROM wallet_transactions
      WHERE user_id = $1
    `;
    const params = [userId];
    let paramIndex = 2;

    if (type) {
      query += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return {
      success: true,
      transactions: result.rows.map(row => ({
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        description: row.description,
        amount: parseFloat(row.amount),
        type: row.type,
        status: row.status,
        metadata: row.metadata,
        created_at: row.created_at
      })),
      count: result.rowCount
    };
  }

  // Get transaction by ID
  async getTransactionById(transactionId, userId) {
    const query = `
      SELECT
        id,
        user_id,
        title,
        description,
        amount,
        type,
        status,
        metadata,
        created_at
      FROM wallet_transactions
      WHERE id = $1 AND user_id = $2
    `;

    const result = await pool.query(query, [transactionId, userId]);

    if (result.rows.length === 0) {
      throw new Error('Transaction not found');
    }

    const row = result.rows[0];
    return {
      success: true,
      transaction: {
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        description: row.description,
        amount: parseFloat(row.amount),
        type: row.type,
        status: row.status,
        metadata: row.metadata,
        created_at: row.created_at
      }
    };
  }

  // Get transaction summary (total credits, total debits)
  async getTransactionSummary(userId) {
    const query = `
      SELECT
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_credits,
        SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as total_debits
      FROM wallet_transactions
      WHERE user_id = $1 AND status = 'COMPLETED'
    `;

    const result = await pool.query(query, [userId]);

    return {
      success: true,
      summary: {
        total_credits: parseFloat(result.rows[0].total_credits) || 0,
        total_debits: parseFloat(result.rows[0].total_debits) || 0
      }
    };
  }

  // Create a new transaction
  async createTransaction(userId, data) {
    const { title, description, amount, type, status = 'COMPLETED', metadata = {} } = data;

    const query = `
      INSERT INTO wallet_transactions
      (user_id, title, description, amount, type, status, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const result = await pool.query(query, [
      userId,
      title,
      description,
      amount,
      type,
      status,
      JSON.stringify(metadata)
    ]);

    const row = result.rows[0];
    return {
      success: true,
      transaction: {
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        description: row.description,
        amount: parseFloat(row.amount),
        type: row.type,
        status: row.status,
        metadata: row.metadata,
        created_at: row.created_at
      }
    };
  }

  // Get balance history for a date range
  async getBalanceHistory(userId, startDate, endDate) {
    const query = `
      SELECT
        SUM(amount) as balance_change
      FROM wallet_transactions
      WHERE user_id = $1
        AND created_at >= $2
        AND created_at <= $3
        AND status = 'COMPLETED'
    `;

    const result = await pool.query(query, [userId, startDate, endDate]);

    return {
      success: true,
      balance: parseFloat(result.rows[0].balance_change) || 0
    };
  }
}

module.exports = new WalletService();
