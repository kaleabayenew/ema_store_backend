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

  // Create a new transaction.
  // User-submitted rows are ALWAYS recorded as PENDING — a client must never
  // be able to write a COMPLETED transaction (that would fake credits).
  async createTransaction(userId, data) {
    const { title, description, amount, type, metadata = {} } = data;
    const { AppError } = require('../../core/errors/app_error');

    const ALLOWED_TYPES = new Set(['DEPOSIT', 'WITHDRAWAL', 'PURCHASE', 'REFUND', 'ADJUSTMENT', 'BONUS']);
    const value = parseFloat(amount);
    if (!Number.isFinite(value) || value === 0 || Math.abs(value) > 1000000) {
      throw new AppError('Invalid transaction amount.', 400, 'INVALID_AMOUNT');
    }
    if (type && !ALLOWED_TYPES.has(String(type).toUpperCase())) {
      throw new AppError('Invalid transaction type.', 400, 'INVALID_TYPE');
    }
    if (title && String(title).length > 200) {
      throw new AppError('Title is too long.', 400, 'TITLE_TOO_LONG');
    }

    const query = `
      INSERT INTO wallet_transactions
      (user_id, title, description, amount, type, status, metadata)
      VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)
      RETURNING *
    `;

    const result = await pool.query(query, [
      userId,
      String(title || 'Transaction').slice(0, 200),
      description ? String(description).slice(0, 1000) : null,
      value,
      type ? String(type).toUpperCase() : 'ADJUSTMENT',
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

  // Customer deposit request — recorded as PENDING until staff confirms payment.
  async deposit(userId, { amount, paymentMethod, reference, idempotencyKey }) {
    const value = parseFloat(amount);
    if (!Number.isFinite(value) || value <= 0 || value > 1000000) {
      const { AppError } = require('../../core/errors/app_error');
      throw new AppError('Amount must be between 0.01 and 1,000,000.', 400, 'INVALID_AMOUNT');
    }
    const method = String(paymentMethod || '').trim();
    const ref = String(reference || '').trim();
    if (!method || method.length > 50) {
      const { AppError } = require('../../core/errors/app_error');
      throw new AppError('A valid payment method is required.', 400, 'INVALID_PAYMENT_METHOD');
    }
    if (ref.length < 3 || ref.length > 120) {
      const { AppError } = require('../../core/errors/app_error');
      throw new AppError('A payment reference (3–120 characters) is required.', 400, 'REFERENCE_REQUIRED');
    }

    if (idempotencyKey) {
      // Scoped to the user — a key must never resolve to someone else's row.
      const existing = await pool.query(
        `SELECT * FROM wallet_transactions WHERE idempotency_key = $1 AND user_id = $2`,
        [idempotencyKey, userId],
      );
      if (existing.rows.length > 0) {
        return { success: true, transaction: this._mapRow(existing.rows[0]), duplicate: true };
      }
    }

    const result = await pool.query(
      `INSERT INTO wallet_transactions
         (user_id, title, description, amount, type, status, metadata, idempotency_key)
       VALUES ($1, 'Wallet deposit', $2, $3, 'DEPOSIT', 'PENDING', $4, $5)
       RETURNING *`,
      [
        userId,
        `Deposit via ${method} — ref ${ref}`,
        value,
        JSON.stringify({ payment_method: method, reference: ref }),
        idempotencyKey || null,
      ],
    );
    return { success: true, transaction: this._mapRow(result.rows[0]) };
  }

  // Customer withdrawal request — debits balance immediately, marked PENDING payout.
  async withdraw(userId, { amount, paymentMethod, accountNumber, accountName, authVerification, idempotencyKey }) {
    const value = parseFloat(amount);
    if (!Number.isFinite(value) || value <= 0 || value > 1000000) {
      const { AppError } = require('../../core/errors/app_error');
      throw new AppError('Amount must be between 0.01 and 1,000,000.', 400, 'INVALID_AMOUNT');
    }
    const method = String(paymentMethod || '').trim();
    const acctName = String(accountName || '').trim();
    const acctNumber = String(accountNumber || '').trim();
    if (!method || method.length > 50) {
      const { AppError } = require('../../core/errors/app_error');
      throw new AppError('A valid payment method is required.', 400, 'INVALID_PAYMENT_METHOD');
    }
    if (acctName.length < 2 || acctName.length > 120) {
      const { AppError } = require('../../core/errors/app_error');
      throw new AppError('Account holder name is required (2–120 characters).', 400, 'ACCOUNT_NAME_REQUIRED');
    }
    if (acctNumber.length < 4 || acctNumber.length > 60) {
      const { AppError } = require('../../core/errors/app_error');
      throw new AppError('A valid account number is required (4–60 characters).', 400, 'ACCOUNT_NUMBER_REQUIRED');
    }

    if (idempotencyKey) {
      // Scoped to the user — a key must never resolve to someone else's row.
      const existing = await pool.query(
        `SELECT * FROM wallet_transactions WHERE idempotency_key = $1 AND user_id = $2`,
        [idempotencyKey, userId],
      );
      if (existing.rows.length > 0) {
        return { success: true, transaction: this._mapRow(existing.rows[0]), duplicate: true };
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: userRows } = await client.query(
        `SELECT balance FROM users WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      if (userRows.length === 0) {
        const { AppError } = require('../../core/errors/app_error');
        throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
      }
      const current = parseFloat(userRows[0].balance) || 0;
      if (current < value) {
        const { AppError } = require('../../core/errors/app_error');
        throw new AppError(
          `Insufficient balance. Available: ETB ${current.toFixed(2)}.`,
          400,
          'INSUFFICIENT_BALANCE',
        );
      }

      await client.query(
        `UPDATE users SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [value, userId],
      );

      const result = await client.query(
        `INSERT INTO wallet_transactions
           (user_id, title, description, amount, type, status, metadata, idempotency_key)
         VALUES ($1, 'Wallet withdrawal', $2, $3, 'WITHDRAWAL', 'PENDING', $4, $5)
         RETURNING *`,
        [
          userId,
          `Withdrawal via ${method} to ${acctName} (${acctNumber})`,
          -value,
          JSON.stringify({
            payment_method: method,
            account_number: acctNumber,
            account_name: acctName,
            auth_verified: Boolean(authVerification),
          }),
          idempotencyKey || null,
        ],
      );

      const { rows: bal } = await client.query(`SELECT balance FROM users WHERE id = $1`, [userId]);
      await client.query('COMMIT');

      return {
        success: true,
        transaction: this._mapRow(result.rows[0]),
        balance: parseFloat(bal[0].balance) || 0,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  _mapRow(row) {
    return {
      id: row.id,
      user_id: row.user_id,
      title: row.title,
      description: row.description,
      amount: parseFloat(row.amount),
      type: row.type,
      status: row.status,
      metadata: row.metadata,
      created_at: row.created_at,
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
