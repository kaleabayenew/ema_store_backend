const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../../core/config/database');
const { otpHmacSecret } = require('../../core/config');
const { AppError } = require('../../core/errors/app_error');
const { sendOtp: sendTelegramBotOtp } = require('../../core/services/telegram-bot.service');
const { issueTokens, revokeAllForUser } = require('./token.service');
const { logAuthEvent } = require('./audit.service');

const IS_PROD = process.env.NODE_ENV === 'production';

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

/** Cryptographically secure 6-digit OTP */
const generateOtp = () => String(crypto.randomInt(100_000, 1_000_000));

/** OTP validity window in minutes */
const OTP_TTL_MINUTES = 15;
/** Minimum seconds between two OTPs for the same phone + type */
const OTP_RESEND_COOLDOWN_SECONDS = 60;
/** Default max wrong attempts if the column is empty */
const DEFAULT_MAX_ATTEMPTS = 5;
/** bcrypt cost factor — DUMMY_HASH must match real hashes */
const BCRYPT_COST = 12;

/** OTP codes are stored as HMAC-SHA256(phone|type|code) — never plaintext. */
const otpHash = (phone, type, code) =>
  crypto
    .createHmac('sha256', otpHmacSecret)
    .update(`${phone}|${type}|${code}`)
    .digest('hex');

/** Constant-time string comparison */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Password policy ──────────────────────────────────────────────────────────
const MIN_PASSWORD_BYTES = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt limit

const COMMON_PASSWORDS = new Set([
  '123456', 'password', '12345678', 'qwerty', '123456789', '12345',
  '1234', '111111', '1234567', '123123', 'abc123', '123321', 'password1',
  'iloveyou', '1q2w3e4r', '000000', 'qwerty123', 'zaq12wsx', 'dragon',
  'sunshine', 'princess', 'letmein', '654321', 'monkey', '27653',
  '1qaz2wsx', '123qwe', 'qazwsx', 'trustno1', 'starwars', 'football',
  'baseball', 'welcome', 'admin', 'master', 'hello123', 'freedom',
  'whatever', 'qazwsxedc', 'password123', 'passw0rd', 'p@ssw0rd',
  '123654', '159753', '987654321', '112233', '121212', '696969',
]);

function assertValidPassword(password, phone) {
  const weak = () =>
    new AppError('Password is too weak.', 400, 'WEAK_PASSWORD');

  if (typeof password !== 'string' || !password) throw weak();

  const bytes = Buffer.byteLength(password, 'utf8');
  if (bytes < MIN_PASSWORD_BYTES || bytes > MAX_PASSWORD_BYTES) throw weak();

  if (COMMON_PASSWORDS.has(password.toLowerCase())) throw weak();

  if (phone) {
    const digits = String(phone).replace(/\D/g, '');
    if (password === digits || password === String(phone)) throw weak();
  }
}

// A real bcrypt hash used to keep login timing the same when the user does not exist
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ethiopian mobile numbers only: +2519XXXXXXXX or +2517XXXXXXXX. */
const PHONE_RE = /^\+251[79]\d{8}$/;

/** Same delay for "nothing happened" paths so timing does not reveal accounts. */
const quietDelay = () => sleep(250 + Math.floor(Math.random() * 150));

/**
 * The bcrypt hash a pending registration chose, from the newest REGISTRATION
 * code of the last 24 hours. Used so "resend code" keeps the password.
 */
async function latestPendingHash(canonicalPhone) {
  const { rows } = await pool.query(
    `SELECT pending_password_hash FROM otp_codes
      WHERE phone = $1 AND type = 'REGISTRATION'
        AND pending_password_hash IS NOT NULL
        AND created_at > NOW() - INTERVAL '1 day'
      ORDER BY created_at DESC LIMIT 1`,
    [canonicalPhone],
  );
  return rows[0] ? rows[0].pending_password_hash : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Send OTP  (persists HMAC hash to DB and sends via Telegram Bot)
//  Returns { delivered } — the code itself is NEVER returned to the caller.
// ─────────────────────────────────────────────────────────────────────────────
async function sendOtp(phone, type = 'REGISTRATION', { pendingPasswordHash = null, req = null } = {}) {
  const canonicalPhone = normalizePhone(phone);

  // Cooldown: stop OTP spamming
  const { rows: lastRows } = await pool.query(
    `SELECT created_at FROM otp_codes
     WHERE phone = $1 AND type = $2
     ORDER BY created_at DESC LIMIT 1`,
    [canonicalPhone, type],
  );
  if (lastRows.length > 0) {
    const ageSeconds = (Date.now() - new Date(lastRows[0].created_at).getTime()) / 1000;
    if (ageSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
      const wait = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - ageSeconds);
      throw new AppError(
        `Please wait ${wait} seconds before requesting a new code.`,
        429,
        'OTP_COOLDOWN',
      );
    }
  }

  // A resend must keep the password chosen at sign-up, otherwise the account
  // would be activated with an unusable password.
  let carriedHash = pendingPasswordHash;
  if (!carriedHash && type === 'REGISTRATION') {
    carriedHash = await latestPendingHash(canonicalPhone);
  }

  const code = generateOtp();
  const codeHash = otpHash(canonicalPhone, type, code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1_000);

  // Invalidate old codes of the same type for this phone
  await pool.query(
    `UPDATE otp_codes SET is_used = true
     WHERE phone = $1 AND type = $2 AND is_used = false`,
    [canonicalPhone, type],
  );

  await pool.query(
    `INSERT INTO otp_codes (phone, code_hash, type, expires_at, pending_password_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [canonicalPhone, codeHash, type, expiresAt, carriedHash],
  );

  // Deliver via Telegram Bot (only if the user has linked their account)
  let delivered = false;
  const { rows: chatRows } = await pool.query(
    'SELECT chat_id FROM telegram_chat_ids WHERE phone = $1',
    [canonicalPhone],
  );

  if (chatRows.length > 0) {
    try {
      const result = await sendTelegramBotOtp(chatRows[0].chat_id, code, type);
      delivered = !!(result && result.success);
    } catch (err) {
      console.error('[OTP] Telegram delivery failed:', err.code || err.message);
    }
  }

  logAuthEvent({
    event: delivered ? 'OTP_SENT' : 'OTP_FAILED',
    phone: canonicalPhone,
    req,
    meta: { type },
  });

  // Development only: print the code so you can test without Telegram.
  // Requires OTP_DEV_LOG=true explicitly; never in production.
  if (!IS_PROD && !delivered && process.env.OTP_DEV_LOG === 'true') {
    console.log(`[OTP DEV] ${canonicalPhone} → ${code} (${type})`);
  }

  return { delivered };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Verify OTP
//  - looks up the latest unused code for this phone/type
//  - EVERY guess is counted first, atomically, on the pool (never inside a
//    caller's transaction) so a rollback can never undo a failed attempt and
//    parallel guesses cannot beat the limit
//  - wrong code  → attempt stays counted (code burned after max attempts)
//  - right code  → consumed atomically, unless { consume: false } is passed;
//    then it returns { id, pendingPasswordHash } and the caller consumes it
//    inside its own transaction
// ─────────────────────────────────────────────────────────────────────────────
async function verifyOtp(phone, code, type = 'REGISTRATION', { consume = true } = {}) {
  const canonicalPhone = normalizePhone(phone);
  const submitted = String(code || '').trim();

  const { rows } = await pool.query(
    `SELECT id, expires_at, pending_password_hash
     FROM otp_codes
     WHERE phone = $1 AND type = $2 AND is_used = false
     ORDER BY created_at DESC
     LIMIT 1`,
    [canonicalPhone, type],
  );

  const otp = rows[0];
  if (!otp) {
    throw new AppError('Invalid OTP code.', 400, 'OTP_INVALID');
  }

  const burn = () =>
    pool.query('UPDATE otp_codes SET is_used = true WHERE id = $1', [otp.id]);

  if (new Date() > new Date(otp.expires_at)) {
    await burn();
    throw new AppError('OTP has expired. Request a new one.', 400, 'OTP_EXPIRED');
  }

  // Count this attempt BEFORE comparing. No row back = no attempts left.
  const { rows: counted } = await pool.query(
    `UPDATE otp_codes
        SET attempts = attempts + 1
      WHERE id = $1 AND is_used = false
        AND attempts < COALESCE(max_attempts, $2::int)
      RETURNING code_hash, attempts, COALESCE(max_attempts, $2::int) AS max_attempts`,
    [otp.id, DEFAULT_MAX_ATTEMPTS],
  );
  if (counted.length === 0) {
    await burn();
    throw new AppError('Too many incorrect attempts. Request a new code.', 429, 'OTP_MAX_ATTEMPTS');
  }

  const row = counted[0];
  const expectedHash = otpHash(canonicalPhone, type, submitted);
  if (!row.code_hash || !safeEqual(row.code_hash, expectedHash)) {
    if (row.attempts >= row.max_attempts) await burn();
    throw new AppError('Invalid OTP code.', 400, 'OTP_INVALID');
  }

  if (!consume) {
    return { id: otp.id, pendingPasswordHash: otp.pending_password_hash || null };
  }

  const { rows: used } = await pool.query(
    `UPDATE otp_codes SET is_used = true WHERE id = $1 AND is_used = false RETURNING id`,
    [otp.id],
  );
  if (used.length === 0) throw new AppError('OTP already used.', 400, 'OTP_USED');

  return otp.id;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Referral helper (read-only check, done BEFORE the OTP is consumed)
// ─────────────────────────────────────────────────────────────────────────────
async function findValidReferral(referralCode) {
  const { rows } = await pool.query(
    `SELECT r.*, ru.phone AS referrer_phone
       FROM referral_codes r
       JOIN users ru ON ru.id = r.user_id
      WHERE r.code = $1 AND r.is_active = true
        AND (r.expires_at IS NULL OR r.expires_at > NOW())
        AND r.total_uses < r.max_uses`,
    [referralCode],
  );
  if (rows.length === 0) {
    throw new AppError(
      'Invalid or expired referral code. Please check and try again.',
      400,
      'INVALID_REFERRAL_CODE',
    );
  }
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Register  — Step 1: persist user + profile, Step 2: confirm via OTP
// ─────────────────────────────────────────────────────────────────────────────
async function registerStep1({ phone, fullName, password, referralCode }, { req = null } = {}) {
  const canonicalPhone = normalizePhone(phone);
  if (!PHONE_RE.test(canonicalPhone)) {
    throw new AppError('Invalid phone number.', 400, 'INVALID_PHONE');
  }
  assertValidPassword(password, canonicalPhone);

  const { rows } = await pool.query(
    `SELECT id, is_active, is_blocked, is_verified, role FROM users WHERE phone = $1`,
    [canonicalPhone],
  );

  // Only a genuinely pending CUSTOMER may restart sign-up. Active, blocked,
  // suspended (verified but inactive) and non-customer accounts are refused —
  // otherwise a blocked user could re-register and unblock themselves.
  if (rows.length > 0) {
    const u = rows[0];
    if (u.is_active || u.is_blocked || u.is_verified || u.role !== 'CUSTOMER') {
      throw new AppError('Phone number already registered. Please sign in.', 409, 'PHONE_TAKEN');
    }
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  // Pending users get a random unusable hash — the real password is only
  // applied in registerStep2 after the OTP is verified.
  const unusableHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_COST);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (rows.length > 0) {
      // Pending activation — update name only, NEVER the password here.
      const existing = rows[0];
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
        [canonicalPhone, unusableHash],
      );
      await client.query(
        `INSERT INTO customer_user (user_id, full_name)
         VALUES ($1, $2)`,
        [userRows[0].id, fullName.trim()],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logAuthEvent({
    event: 'REGISTER_STARTED',
    userId: rows[0] ? rows[0].id : null,
    phone: canonicalPhone,
    req,
  });

  // The bcrypt hash travels with the OTP row and is only copied to the user
  // after the OTP verifies — an attacker cannot overwrite a pending account.
  return sendOtp(canonicalPhone, 'REGISTRATION', {
    pendingPasswordHash: passwordHash,
    req,
  });
}

async function registerStep2({ phone, code, referralCode }, { req = null } = {}) {
  const canonicalPhone = normalizePhone(phone);

  // Check the referral first, so a bad referral does not waste the user's OTP
  const referral = referralCode ? await findValidReferral(referralCode) : null;

  // Check the code OUTSIDE the transaction: a wrong guess must stay counted
  // even though the transaction below is rolled back on failure.
  const otp = await verifyOtp(canonicalPhone, code, 'REGISTRATION', { consume: false });

  if (!otp.pendingPasswordHash) {
    // e.g. the code was issued without a password (older than 24 h): never
    // activate an account whose password nobody chose.
    throw new AppError('Registration expired. Please sign up again.', 400, 'REGISTRATION_EXPIRED');
  }

  const client = await pool.connect();
  let userId = null;
  try {
    await client.query('BEGIN');

    // Consume the code and activate the user in ONE transaction: if the
    // activation fails, the code is not burned.
    const { rows: used } = await client.query(
      `UPDATE otp_codes SET is_used = true WHERE id = $1 AND is_used = false RETURNING id`,
      [otp.id],
    );
    if (used.length === 0) throw new AppError('OTP already used.', 400, 'OTP_USED');

    const { rows: userRows } = await client.query(
      `UPDATE users
          SET is_active = true, updated_at = NOW(), password_hash = $2
        WHERE phone = $1
          AND is_active = false
          AND COALESCE(is_blocked, false) = false
          AND role = 'CUSTOMER'
        RETURNING id`,
      [canonicalPhone, otp.pendingPasswordHash],
    );
    if (userRows.length === 0) {
      throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
    }
    userId = userRows[0].id;

    // Self-referral is blocked by user id AND by phone.
    const isSelfReferral =
      referral &&
      (referral.user_id === userId || referral.referrer_phone === canonicalPhone);

    if (referral && !isSelfReferral) {
      await client.query(
        'UPDATE users SET referred_by = $1, coins = coins + $2 WHERE id = $3',
        [referral.user_id, referral.reward_coins, userId],
      );
      await client.query(
        'UPDATE referral_codes SET total_uses = total_uses + 1 WHERE id = $1',
        [referral.id],
      );
      await client.query(
        'UPDATE users SET coins = coins + $2 WHERE id = $1',
        [referral.user_id, referral.reward_coins],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logAuthEvent({
    event: 'REGISTER_COMPLETED',
    userId,
    phone: canonicalPhone,
    req,
  });

  return _buildAuthResponse(canonicalPhone, { req });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Login (phone for customers, email for admins)
// ─────────────────────────────────────────────────────────────────────────────
const LOGIN_SELECT = `
  SELECT u.id, u.phone, u.email, u.password_hash, u.role, u.is_active, u.is_verified,
         u.is_blocked, u.block_reason, u.balance, u.coins, u.profile_image,
         u.failed_login_count, u.locked_until,
         cp.full_name, au.admin_role, au.allowed_pages
  FROM users u
  LEFT JOIN customer_user cp ON cp.user_id = u.id
  LEFT JOIN admin_user au ON au.user_id = u.id`;

/** 5th failure locks for 5 min; each extra failure doubles it, capped at 60 min. */
async function recordFailedLogin(user) {
  const newCount = (user.failed_login_count || 0) + 1;
  let lockedUntil = null;
  if (newCount >= 5) {
    const minutes = Math.min(5 * Math.pow(2, newCount - 5), 60);
    lockedUntil = new Date(Date.now() + minutes * 60 * 1000);
  }
  await pool.query(
    `UPDATE users SET failed_login_count = $2, locked_until = $3, updated_at = NOW()
     WHERE id = $1`,
    [user.id, newCount, lockedUntil],
  );
  return lockedUntil;
}

async function login({ phone, email, password }, { req = null } = {}) {
  const canonicalPhone = phone ? normalizePhone(phone) : null;
  const normalizedEmail = email ? email.trim().toLowerCase() : null;

  let rows;
  if (canonicalPhone) {
    ({ rows } = await pool.query(`${LOGIN_SELECT} WHERE u.phone = $1`, [canonicalPhone]));
  } else if (normalizedEmail) {
    ({ rows } = await pool.query(`${LOGIN_SELECT} WHERE u.email = $1`, [normalizedEmail]));
  } else {
    throw new AppError('Phone or email is required.', 400, 'MISSING_CREDENTIALS');
  }

  const user = rows[0];

  // Always run bcrypt, so response time does not reveal if the account exists
  const match = await bcrypt.compare(String(password), user ? user.password_hash : DUMMY_HASH);

  // A locked account answers 429 for EVERY password, right or wrong. If only the
  // right password got 429, the lock itself would tell an attacker which guess
  // is correct. Attempts made while locked are not counted, so the lock cannot
  // be stretched forever by someone hammering a victim's number.
  if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
    logAuthEvent({ event: 'LOGIN_LOCKED', userId: user.id, phone: user.phone, req });
    throw new AppError('Too many attempts. Try again later.', 429, 'ACCOUNT_TEMP_LOCKED');
  }

  // One generic message for "no account" and "wrong password"
  if (!user || !match) {
    if (user) {
      const lockedUntil = await recordFailedLogin(user);
      logAuthEvent({
        event: lockedUntil && lockedUntil > new Date() ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
        userId: user.id,
        phone: user.phone,
        req,
      });
    }
    throw new AppError('Invalid phone or password.', 401, 'INVALID_CREDENTIALS');
  }

  // Account status is only revealed AFTER the password is correct
  if (user.is_blocked || (!user.is_active && user.is_verified)) {
    throw new AppError(
      user.block_reason ||
        'Your account has been suspended by the administration. Please contact support.',
      403,
      'ACCOUNT_BLOCKED',
    );
  }
  if (!user.is_active) {
    throw new AppError('Account not yet activated. Please verify your OTP.', 403, 'NOT_ACTIVATED');
  }

  // Successful login resets the failure counter.
  await pool.query(
    `UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = NOW()
     WHERE id = $1`,
    [user.id],
  );

  const effectiveRole = user.admin_role || user.role;
  const tokens = await issueTokens(
    { id: user.id, role: effectiveRole, admin_role: user.admin_role },
    req,
  );

  logAuthEvent({ event: 'LOGIN_SUCCESS', userId: user.id, phone: user.phone, req });

  return {
    ...tokens,
    token: tokens.accessToken, // kept for old app versions
    user: {
      id: user.id,
      phone: user.phone,
      email: user.email,
      fullName: user.full_name || user.email || '',
      role: effectiveRole,
      adminRole: user.admin_role || effectiveRole,
      balance: parseFloat(user.balance) || 0,
      coins: user.coins || 0,
      profileImage: user.profile_image || null,
      allowedPages: user.admin_role ? user.allowed_pages || [] : [],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Forgot password
// ─────────────────────────────────────────────────────────────────────────────
async function forgotPasswordStep1({ phone }, { req = null } = {}) {
  const canonicalPhone = normalizePhone(phone);

  let rows = [];
  if (PHONE_RE.test(canonicalPhone)) {
    ({ rows } = await pool.query(
      `SELECT id FROM users
        WHERE phone = $1 AND is_active = true AND COALESCE(is_blocked, false) = false`,
      [canonicalPhone],
    ));
  }

  // Do not reveal whether the number is registered — equalize the timing.
  if (rows.length === 0) {
    await quietDelay(); // 250–400 ms
    return { delivered: false };
  }

  try {
    return await sendOtp(canonicalPhone, 'PASSWORD_RESET', { req });
  } catch (err) {
    // A cooldown error would only ever appear for registered numbers, which
    // lets anyone list them. Answer exactly like the "not registered" case.
    if (err && err.code === 'OTP_COOLDOWN') return { delivered: false };
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Resend OTP (customer flows). Same generic outcome for every number.
// ─────────────────────────────────────────────────────────────────────────────
async function resendOtp(phone, type, { req = null } = {}) {
  if (type === 'PASSWORD_RESET') {
    return forgotPasswordStep1({ phone }, { req });
  }

  const canonicalPhone = normalizePhone(phone);

  // Only a genuinely pending CUSTOMER sign-up with a saved password can get a
  // new registration code; everything else behaves like "nothing to resend".
  let pending = false;
  if (PHONE_RE.test(canonicalPhone)) {
    const { rows } = await pool.query(
      `SELECT id FROM users
        WHERE phone = $1 AND is_active = false
          AND COALESCE(is_blocked, false) = false
          AND COALESCE(is_verified, false) = false
          AND role = 'CUSTOMER'`,
      [canonicalPhone],
    );
    pending = rows.length > 0 && !!(await latestPendingHash(canonicalPhone));
  }

  if (!pending) {
    await quietDelay();
    return { delivered: false };
  }

  try {
    return await sendOtp(canonicalPhone, 'REGISTRATION', { req });
  } catch (err) {
    if (err && err.code === 'OTP_COOLDOWN') return { delivered: false };
    throw err;
  }
}

async function forgotPasswordStep2({ phone, code, newPassword }, { req = null } = {}) {
  const canonicalPhone = normalizePhone(phone);
  assertValidPassword(newPassword, canonicalPhone);

  await verifyOtp(canonicalPhone, code, 'PASSWORD_RESET');

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const { rows } = await pool.query(
    `UPDATE users
        SET password_hash = $1, password_changed_at = NOW(),
            failed_login_count = 0, locked_until = NULL, updated_at = NOW()
      WHERE phone = $2 AND is_active = true
      RETURNING id`,
    [passwordHash, canonicalPhone],
  );

  if (!rows[0]) {
    throw new AppError('Could not reset the password.', 400, 'RESET_FAILED');
  }

  // Kill every existing session — old refresh tokens must not survive a reset.
  await revokeAllForUser(rows[0].id);
  logAuthEvent({
    event: 'PASSWORD_RESET',
    userId: rows[0].id,
    phone: canonicalPhone,
    req,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal helper
// ─────────────────────────────────────────────────────────────────────────────
async function _buildAuthResponse(canonicalPhone, { req = null } = {}) {
  const { rows } = await pool.query(
    `SELECT u.id, u.phone, u.email, u.role, u.balance, u.coins, u.profile_image,
            cp.full_name, au.admin_role
     FROM users u
     LEFT JOIN customer_user cp ON cp.user_id = u.id
     LEFT JOIN admin_user au ON au.user_id = u.id
     WHERE u.phone = $1`,
    [canonicalPhone],
  );
  const user = rows[0];
  if (!user) throw new AppError('User not found.', 404, 'USER_NOT_FOUND');

  const effectiveRole = user.admin_role || user.role;
  const tokens = await issueTokens(
    { id: user.id, role: effectiveRole, admin_role: user.admin_role },
    req,
  );

  return {
    ...tokens,
    token: tokens.accessToken, // kept for old app versions
    user: {
      id: user.id,
      phone: user.phone,
      email: user.email,
      fullName: user.full_name || user.email || '',
      role: effectiveRole,
      adminRole: user.admin_role || effectiveRole,
      balance: parseFloat(user.balance) || 0,
      coins: user.coins || 0,
      profileImage: user.profile_image || null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Update profile image
// ─────────────────────────────────────────────────────────────────────────────
async function updateProfileImage(userId, profileImageUrl) {
  await pool.query(
    `UPDATE users SET profile_image = $1, updated_at = NOW() WHERE id = $2`,
    [profileImageUrl, userId],
  );
}

async function getCurrentUser(userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.phone, u.email, u.role, u.balance, u.coins, u.profile_image,
            COALESCE(u.is_blocked, false) AS is_blocked,
            u.block_reason,
            u.is_active,
            u.referral_code,
            cp.full_name
     FROM users u
     LEFT JOIN customer_user cp ON cp.user_id = u.id
     WHERE u.id = $1`,
    [userId],
  );
  if (rows.length === 0) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  const u = rows[0];

  if (u.is_blocked || u.is_active === false) {
    throw new AppError(
      u.block_reason ||
        'Your account has been suspended by the administration. Please contact support.',
      403,
      'ACCOUNT_BLOCKED',
    );
  }

  return {
    id: u.id,
    phone: u.phone,
    email: u.email,
    fullName: u.full_name || u.phone,
    role: u.role,
    balance: parseFloat(u.balance) || 0,
    coins: u.coins || 0,
    referralCode: u.referral_code || '',
    profileImage: u.profile_image || null,
    isBlocked: !!u.is_blocked,
    isActive: u.is_active,
    blockReason: u.block_reason || null,
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
  resendOtp,
  updateProfileImage,
  getCurrentUser,
};
