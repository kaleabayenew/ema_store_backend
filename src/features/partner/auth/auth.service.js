const { pool } = require('../../../core/config/database');
const { signToken } = require('../../../core/utils/jwt');
const { AppError } = require('../../../core/errors/app_error');
const {
  sendOtp,
  verifyOtp,
  normalizePhone,
} = require('../../auth/auth.service');

// ─────────────────────────────────────────────────────────────────────────────
//  Register — Step 1
// ─────────────────────────────────────────────────────────────────────────────
async function register(phone, ownerName, shopName, address, city) {
  const normalizedPhone = normalizePhone(phone);

  const { rows } = await pool.query(
    `SELECT id FROM users WHERE phone = $1 AND role = 'PARTNER'`,
    [normalizedPhone],
  );
  if (rows.length > 0) {
    throw new AppError('A partner account with this phone already exists.', 409, 'PHONE_TAKEN');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `INSERT INTO users (phone, role, is_verified, is_active)
       VALUES ($1, 'PARTNER', false, false)
       RETURNING id`,
      [normalizedPhone],
    );
    const userId = userRows[0].id;

    await client.query(
      `INSERT INTO partner_profile (user_id, owner_name, shop_name, business_name, address, city)
       VALUES ($1, $2, $3, $3, $4, $5)`,
      [userId, ownerName, shopName, address, city],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await sendOtp(normalizedPhone, 'PARTNER_REGISTER');
  return { message: 'OTP sent. Please verify.' };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Register — Step 2 (verify OTP)
// ─────────────────────────────────────────────────────────────────────────────
async function verifyRegister(phone, otp) {
  const normalizedPhone = normalizePhone(phone);

  await verifyOtp(normalizedPhone, otp, 'PARTNER_REGISTER');

  await pool.query(
    `UPDATE users SET is_verified = true, updated_at = NOW()
     WHERE phone = $1 AND role = 'PARTNER'`,
    [normalizedPhone],
  );

  return { message: 'Registration submitted. Awaiting admin approval.', status: 'PENDING' };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Login — Step 1 (send OTP)
// ─────────────────────────────────────────────────────────────────────────────
async function login(phone) {
  const normalizedPhone = normalizePhone(phone);

  const { rows } = await pool.query(
    `SELECT id FROM users WHERE phone = $1 AND role = 'PARTNER'`,
    [normalizedPhone],
  );
  if (rows.length === 0) {
    throw new AppError('Partner account not found.', 404, 'USER_NOT_FOUND');
  }

  await sendOtp(normalizedPhone, 'PARTNER_LOGIN');
  return { message: 'OTP sent.' };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Login — Step 2 (verify OTP, issue token)
// ─────────────────────────────────────────────────────────────────────────────
async function verifyLogin(phone, otp) {
  const normalizedPhone = normalizePhone(phone);

  await verifyOtp(normalizedPhone, otp, 'PARTNER_LOGIN');

  const { rows } = await pool.query(
    `SELECT users.id, users.phone, users.role, users.is_active, users.is_blocked, users.block_reason,
            partner_profile.shop_name, partner_profile.owner_name
     FROM users
     JOIN partner_profile ON partner_profile.user_id = users.id
     WHERE users.phone = $1 AND users.role = 'PARTNER'`,
    [normalizedPhone],
  );

  const user = rows[0];
  if (!user) {
    throw new AppError('Partner account not found.', 404, 'USER_NOT_FOUND');
  }
  if (user.is_blocked) {
    throw new AppError(user.block_reason || 'Account blocked.', 403, 'ACCOUNT_BLOCKED');
  }
  if (!user.is_active) {
    return { status: 'PENDING', message: 'Account pending approval.' };
  }

  // Partner app has no refresh-token flow yet, so it keeps a longer-lived token.
  const token = signToken(
    { id: user.id, role: 'PARTNER', shopName: user.shop_name },
    { expiresIn: '7d' },
  );

  return {
    token,
    partner: {
      id: user.id,
      shopName: user.shop_name,
      ownerName: user.owner_name,
      status: 'ACTIVE',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Get current partner profile
// ─────────────────────────────────────────────────────────────────────────────
async function getMe(userId) {
  const { rows } = await pool.query(
    `SELECT users.id, users.phone, users.role, users.is_active, users.is_blocked,
            partner_profile.*
     FROM users
     JOIN partner_profile ON partner_profile.user_id = users.id
     WHERE users.id = $1`,
    [userId],
  );

  if (rows.length === 0) {
    throw new AppError('Partner not found.', 404, 'USER_NOT_FOUND');
  }

  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Resend OTP
// ─────────────────────────────────────────────────────────────────────────────
async function resendOtp(phone, type) {
  const normalizedPhone = normalizePhone(phone);
  await sendOtp(normalizedPhone, type);
  return { message: 'OTP resent.' };
}

module.exports = { register, verifyRegister, login, verifyLogin, getMe, resendOtp };
