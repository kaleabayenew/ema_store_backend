const bcrypt   = require('bcryptjs');
const { pool } = require('../../core/config/database');
const { signToken } = require('../../core/utils/jwt');
const { AppError }  = require('../../core/errors/app_error');
const { sendOtp: sendTelegramBotOtp } = require('../../core/services/telegram-bot.service');

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Normalize phone to canonical E.164 (+251XXXXXXXXX) */
function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('251') && digits.length === 12) {
    digits = digits.substring(3);
  } else if (digits.startsWith('0') && digits.length === 10) {
    digits = digits.substring(1);
  }
  return `+251${digits}`;
}

/** Generate a random 6-digit OTP string */
const generateOtp = () =>
  String(Math.floor(100_000 + Math.random() * 900_000));

/** OTP validity window in minutes */
const OTP_TTL_MINUTES = 15;

// ─────────────────────────────────────────────────────────────────────────────
//  Send OTP  (persists to DB and sends via Telegram Bot)
// ─────────────────────────────────────────────────────────────────────────────
async function sendOtp(phone, type = 'REGISTRATION') {
  const canonicalPhone = normalizePhone(phone);
  const code           = generateOtp();
  const expiresAt      = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1_000);

  // Invalidate old codes of the same type for this phone
  await pool.query(
    `UPDATE otp_codes SET is_used = true
     WHERE phone = $1 AND type = $2 AND is_used = false`,
    [canonicalPhone, type],
  );

  await pool.query(
    `INSERT INTO otp_codes (phone, code, type, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [canonicalPhone, code, type, expiresAt],
  );

  // Try to send via Telegram Bot (if user has linked their account)
  const { rows: chatRows } = await pool.query(
    'SELECT chat_id FROM telegram_chat_ids WHERE phone = $1',
    [canonicalPhone],
  );

  if (chatRows.length > 0) {
    // Send via Telegram Bot (free)
    const chatId = chatRows[0].chat_id;
    const result = await sendTelegramBotOtp(chatId, code, type);
    console.log(`[Telegram Bot] Sent to chat ${chatId}: ${code} - Success: ${result.success}`);
  } else {
    // Log OTP to console if user hasn't linked their Telegram account
    console.log(`[OTP FALLBACK] ${canonicalPhone} → ${code} (${type}, expires ${expiresAt.toISOString()})`);
    console.log(`[INFO] User has not linked Telegram account. OTP logged to console.`);
  }

  console.log(`[OTP] ${canonicalPhone} → ${code} (${type}, expires ${expiresAt.toISOString()})`);

  return code;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Verify OTP
// ─────────────────────────────────────────────────────────────────────────────
async function verifyOtp(phone, code, type = 'REGISTRATION') {
  const canonicalPhone = normalizePhone(phone);

  const { rows } = await pool.query(
    `SELECT id, attempts, max_attempts, expires_at, is_used
     FROM otp_codes
     WHERE phone = $1 AND code = $2 AND type = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [canonicalPhone, code.trim(), type],
  );

  const otp = rows[0];

  if (!otp) throw new AppError('Invalid OTP code.', 400, 'OTP_INVALID');
  if (otp.is_used) throw new AppError('OTP already used.', 400, 'OTP_USED');
  if (new Date() > new Date(otp.expires_at)) {
    throw new AppError('OTP has expired. Request a new one.', 400, 'OTP_EXPIRED');
  }
  if (otp.attempts >= otp.max_attempts) {
    throw new AppError('Too many incorrect attempts.', 429, 'OTP_MAX_ATTEMPTS');
  }

  // Increment attempts and mark used
  await pool.query(
    `UPDATE otp_codes SET attempts = attempts + 1, is_used = true WHERE id = $1`,
    [otp.id],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Register  — Step 1: persist user + profile, Step 2: confirm via OTP
// ─────────────────────────────────────────────────────────────────────────────
async function registerStep1({ phone, fullName, password, referralCode }) {
  const canonicalPhone = normalizePhone(phone);

  // Check existing user
  const { rows } = await pool.query(
    `SELECT id, is_active FROM users WHERE phone = $1`,
    [canonicalPhone],
  );

  const passwordHash = await bcrypt.hash(password, 12);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (rows.length > 0) {
      const existing = rows[0];
      if (existing.is_active) {
        throw new AppError('Phone number already registered. Please sign in.', 409, 'PHONE_TAKEN');
      }

      // Pending activation — update details
      await client.query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [passwordHash, existing.id],
      );
      await client.query(
        `UPDATE customer_user SET full_name = $1, updated_at = NOW() WHERE user_id = $2`,
        [fullName.trim(), existing.id],
      );
    } else {
      // Create fresh user in pending state
      const { rows: userRows } = await client.query(
        `INSERT INTO users (phone, password_hash, role, is_active)
         VALUES ($1, $2, 'CUSTOMER', false)
         RETURNING id`,
        [canonicalPhone, passwordHash],
      );
      const userId = userRows[0].id;

      await client.query(
        `INSERT INTO customer_user (user_id, full_name)
         VALUES ($1, $2)`,
        [userId, fullName.trim()],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return sendOtp(canonicalPhone, 'REGISTRATION');
}

async function registerStep2({ phone, code, referralCode }) {
  const canonicalPhone = normalizePhone(phone);
  await verifyOtp(canonicalPhone, code, 'REGISTRATION');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Activate user in DB
    await client.query(
      `UPDATE users SET is_active = true, updated_at = NOW() WHERE phone = $1`,
      [canonicalPhone],
    );

    // Apply referral code if provided
    if (referralCode) {
      const { rows: userRows } = await client.query(
        'SELECT id FROM users WHERE phone = $1',
        [canonicalPhone]
      );
      
      if (userRows.length > 0) {
        const userId = userRows[0].id;
        
        // Validate referral code
        const { rows: referralRows } = await client.query(
          `SELECT * FROM referral_codes 
           WHERE code = $1 AND is_active = true 
           AND (expires_at IS NULL OR expires_at > NOW())
           AND total_uses < max_uses`,
          [referralCode]
        );

        if (referralRows.length > 0) {
          const referral = referralRows[0];
          
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
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return _buildAuthResponse(canonicalPhone);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Login (supports both phone login for customers and email login for admins)
// ─────────────────────────────────────────────────────────────────────────────
async function login({ phone, email, password }) {
  const canonicalPhone = phone ? normalizePhone(phone) : null;
  const normalizedEmail = email ? email.trim().toLowerCase() : null;

  console.log('[Auth Service] Login attempt:', { canonicalPhone, normalizedEmail });

  // Determine query based on whether phone or email is provided
  let query, param;
  if (canonicalPhone) {
    query = `SELECT u.id, u.phone, u.email, u.password_hash, u.role, u.is_active, u.balance, u.coins,
                    cp.full_name, au.admin_role
             FROM users u
             LEFT JOIN customer_user cp ON cp.user_id = u.id
             LEFT JOIN admin_user au ON au.user_id = u.id
             WHERE u.phone = $1`;
    param = canonicalPhone;
  } else if (normalizedEmail) {
    query = `SELECT u.id, u.phone, u.email, u.password_hash, u.role, u.is_active, u.balance, u.coins,
                    cp.full_name, au.admin_role
             FROM users u
             LEFT JOIN customer_user cp ON cp.user_id = u.id
             LEFT JOIN admin_user au ON au.user_id = u.id
             WHERE u.email = $1`;
    param = normalizedEmail;
  } else {
    throw new AppError('Phone or email is required.', 400, 'MISSING_CREDENTIALS');
  }

  const { rows } = await pool.query(query, [param]);
  const user = rows[0];

  console.log('[Auth Service] User found:', !!user, 'Active:', user?.is_active);

  if (!user) {
    throw new AppError('Account not found. Please check your credentials.', 401, 'USER_NOT_FOUND');
  }
  if (!user.is_active) {
    throw new AppError('Account not yet activated. Please verify your OTP.', 403, 'NOT_ACTIVATED');
  }

  const match = await bcrypt.compare(password, user.password_hash);
  console.log('[Auth Service] Password match:', match);
  if (!match) {
    throw new AppError('Incorrect password. Please try again.', 401, 'WRONG_PASSWORD');
  }

  const token = signToken({ id: user.id, phone: user.phone, email: user.email, role: user.role, adminRole: user.admin_role });
  console.log('[Auth Service] Token generated successfully');
  return {
    token,
    user: {
      id: user.id,
      phone: user.phone,
      email: user.email,
      fullName: user.full_name || user.email || '',
      role: user.role,
      adminRole: user.adminRole,
      balance: parseFloat(user.balance) || 0,
      coins: user.coins || 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Forgot password
// ─────────────────────────────────────────────────────────────────────────────
async function forgotPasswordStep1({ phone }) {
  const canonicalPhone = normalizePhone(phone);

  const { rows } = await pool.query(
    `SELECT id FROM users WHERE phone = $1 AND is_active = true`,
    [canonicalPhone],
  );
  if (rows.length === 0) {
    throw new AppError('Phone number not found.', 404, 'USER_NOT_FOUND');
  }

  return sendOtp(canonicalPhone, 'PASSWORD_RESET');
}

async function forgotPasswordStep2({ phone, code, newPassword }) {
  const canonicalPhone = normalizePhone(phone);
  await verifyOtp(canonicalPhone, code, 'PASSWORD_RESET');

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE phone = $2`,
    [passwordHash, canonicalPhone],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal helper
// ─────────────────────────────────────────────────────────────────────────────
async function _buildAuthResponse(canonicalPhone) {
  const { rows } = await pool.query(
    `SELECT u.id, u.phone, u.email, u.role, u.balance, u.coins, cp.full_name, au.admin_role
     FROM users u
     LEFT JOIN customer_user cp ON cp.user_id = u.id
     LEFT JOIN admin_user au ON au.user_id = u.id
     WHERE u.phone = $1`,
    [canonicalPhone],
  );
  const user = rows[0];
  if (!user) throw new AppError('User not found.', 404, 'USER_NOT_FOUND');

  const token = signToken({ id: user.id, phone: user.phone, email: user.email, role: user.role, adminRole: user.admin_role });
  return {
    token,
    user: {
      id: user.id,
      phone: user.phone,
      email: user.email,
      fullName: user.full_name || user.email || '',
      role: user.role,
      adminRole: user.adminRole,
      balance: parseFloat(user.balance) || 0,
      coins: user.coins || 0,
    },
  };
}

module.exports = {
  normalizePhone,
  sendOtp,
  verifyOtp,
  registerStep1,
  registerStep2,
  login,
  forgotPasswordStep1,
  forgotPasswordStep2,
};
