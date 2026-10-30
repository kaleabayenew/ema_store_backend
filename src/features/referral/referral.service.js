const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// ── Generate referral code for user ─────────────────────────────────────────

async function generateReferralCode(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if user already has a referral code
    const { rows: existing } = await client.query(
      'SELECT code FROM referral_codes WHERE user_id = $1',
      [userId]
    );

    if (existing.length > 0) {
      await client.query('ROLLBACK');
      return { code: existing[0].code, isNew: false };
    }

    // Generate unique referral code
    let code;
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      code = `EMA${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const { rows: check } = await client.query(
        'SELECT id FROM referral_codes WHERE code = $1',
        [code]
      );
      isUnique = check.length === 0;
      attempts++;
    }

    if (!isUnique) {
      throw new AppError('Failed to generate unique referral code', 500, 'CODE_GENERATION_FAILED');
    }

    // Insert referral code
    const { rows } = await client.query(
      `INSERT INTO referral_codes (user_id, code, reward_coins, max_uses, expires_at)
       VALUES ($1, $2, 50, 100, NOW() + INTERVAL '1 year')
       RETURNING *`,
      [userId, code]
    );

    // Update user's referral_code column
    await client.query(
      'UPDATE users SET referral_code = $1 WHERE id = $2',
      [code, userId]
    );

    await client.query('COMMIT');
    return { code: rows[0].code, isNew: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Validate referral code ─────────────────────────────────────────────────

async function validateReferralCode(code) {
  const { rows } = await pool.query(
    `SELECT * FROM referral_codes 
     WHERE code = $1 AND is_active = true 
     AND (expires_at IS NULL OR expires_at > NOW())
     AND total_uses < max_uses`,
    [code]
  );

  if (rows.length === 0) {
    return null;
  }

  return rows[0];
}

// ── Apply referral code during registration ───────────────────────────────

async function applyReferralCode(userId, referralCode) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validate referral code
    const referral = await validateReferralCode(referralCode);
    if (!referral) {
      await client.query('ROLLBACK');
      throw new AppError('Invalid or expired referral code', 400, 'INVALID_REFERRAL_CODE');
    }

    // Check if user already referred
    const { rows: existing } = await client.query(
      'SELECT referred_by FROM users WHERE id = $1',
      [userId]
    );

    if (existing[0].referred_by) {
      await client.query('ROLLBACK');
      throw new AppError('User already used a referral code', 400, 'ALREADY_REFERRED');
    }

    // Update user with referral
    await client.query(
      'UPDATE users SET referred_by = $1, coins = coins + $2 WHERE id = $3',
      [referral.user_id, referral.reward_coins, userId]
    );

    // Increment referral usage
    await client.query(
      'UPDATE referral_codes SET total_uses = total_uses + 1 WHERE id = $1',
      [referral.id]
    );

    // Give coins to referrer
    await client.query(
      'UPDATE users SET coins = coins + $2 WHERE id = $1',
      [referral.user_id, referral.reward_coins]
    );

    await client.query('COMMIT');
    return { success: true, coinsEarned: referral.reward_coins };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Get user's referral stats ───────────────────────────────────────────────

async function getReferralStats(userId) {
  const { rows } = await pool.query(
    `SELECT 
      rc.code,
      rc.total_uses,
      rc.max_uses,
      rc.reward_coins,
      u.referral_code
     FROM referral_codes rc
     LEFT JOIN users u ON u.id = rc.user_id
     WHERE rc.user_id = $1`,
    [userId]
  );

  if (rows.length === 0) {
    return null;
  }

  return rows[0];
}

// ── Convert coins to balance ───────────────────────────────────────────────

async function convertCoinsToBalance(userId, coins) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check user's coin balance
    const { rows: user } = await client.query(
      'SELECT coins, balance FROM users WHERE id = $1',
      [userId]
    );

    if (user.length === 0) {
      await client.query('ROLLBACK');
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    if (user[0].coins < coins) {
      await client.query('ROLLBACK');
      throw new AppError('Insufficient coins', 400, 'INSUFFICIENT_COINS');
    }

    // Conversion rate: 100 coins = 1 Birr
    const balanceToAdd = coins / 100;

    // Update user's balance and coins
    await client.query(
      'UPDATE users SET coins = coins - $1, balance = balance + $2 WHERE id = $3',
      [coins, balanceToAdd, userId]
    );

    await client.query('COMMIT');
    return { 
      success: true, 
      coinsConverted: coins, 
      balanceAdded: balanceToAdd,
      newBalance: user[0].balance + balanceToAdd,
      newCoins: user[0].coins - coins
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  generateReferralCode,
  validateReferralCode,
  applyReferralCode,
  getReferralStats,
  convertCoinsToBalance,
};
