const bcrypt = require('bcryptjs');
const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// Staff roles that the Manage Users page controls (excludes CUSTOMER and PARTNER)
const STAFF_ROLES = [
  'SUPER_ADMIN', 'MANAGEMENT', 'CUSTOMER_SUPPORT',
  'PARTNER_MANAGER', 'PRODUCT_MANAGER', 'FINANCE', 'MARKETING',
];

/**
 * List staff users with their admin profile + allowed pages + status.
 */
async function listStaffUsers({ search, role, status, page = 1, limit = 50 } = {}) {
  const offset = (page - 1) * limit;
  const params = [];
  let where = `WHERE u.role = ANY($1::text[])`;
  params.push(STAFF_ROLES);
  let idx = 2;

  if (search) {
    where += ` AND (COALESCE(u.full_name, au.full_name, u.email, u.phone) ILIKE $${idx} OR u.email ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }
  if (role) {
    where += ` AND u.role = $${idx}`;
    params.push(role);
    idx++;
  }
  if (status === 'active') {
    where += ` AND u.is_active = true AND u.is_blocked = false`;
  } else if (status === 'inactive') {
    where += ` AND (u.is_active = false OR u.is_blocked = true)`;
  }

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM users u
     LEFT JOIN admin_user au ON au.user_id = u.id
     ${where}`,
    params,
  );
  const total = countRes.rows[0].total;

  const { rows } = await pool.query(
    `SELECT
       u.id, u.phone, u.email, u.full_name, u.role,
       u.is_active, u.is_blocked, u.block_reason,
       u.last_login, u.created_at,
       au.admin_role, au.allowed_pages
     FROM users u
     LEFT JOIN admin_user au ON au.user_id = u.id
     ${where}
     ORDER BY
       CASE u.role WHEN 'SUPER_ADMIN' THEN 0 ELSE 1 END,
       COALESCE(u.full_name, au.full_name, u.email) ASC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset],
  );

  return {
    users: rows.map((r) => ({
      id: r.id,
      name: r.full_name || r.admin_role ? (r.full_name ?? null) : null,
      fullName: r.full_name ?? null,
      email: r.email ?? '',
      phone: r.phone ?? '',
      role: r.role,
      status: r.is_blocked ? 'INACTIVE' : (r.is_active ? 'ACTIVE' : 'INACTIVE'),
      isActive: r.is_active,
      isBlocked: r.is_blocked,
      blockReason: r.block_reason ?? null,
      allowedPages: Array.isArray(r.allowed_pages) ? r.allowed_pages : [],
      lastLogin: r.last_login ?? null,
      createdAt: r.created_at,
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Create a new staff user. Phone is required (UNIQUE NOT NULL); generate a
 * unique placeholder if the caller didn't supply one.
 */
const STAFF_PASSWORD_MIN = 12;
const STAFF_PASSWORD_MAX = 72;
const COMMON_STAFF_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'qwerty123',
  'welcome123', 'admin1234', 'letmein123', 'changeme123', 'iloveyou123',
]);

function assertStrongStaffPassword(password) {
  const weak = () =>
    new AppError(
      'Password must be 12-72 characters with at least one letter and one number, and must not be a common password.',
      400,
      'WEAK_PASSWORD',
    );
  if (typeof password !== 'string' || password.length < STAFF_PASSWORD_MIN || password.length > STAFF_PASSWORD_MAX) throw weak();
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) throw weak();
  if (COMMON_STAFF_PASSWORDS.has(password.toLowerCase())) throw weak();
}

async function createStaffUser({ fullName, email, phone, password, role, allowedPages }) {
  assertStrongStaffPassword(password);
  if (!STAFF_ROLES.includes(role)) {
    throw new AppError('Invalid staff role.', 400, 'INVALID_ROLE');
  }

  // Ensure unique phone (generate if missing)
  let finalPhone = (phone && phone.trim()) || null;
  if (!finalPhone) {
    finalPhone = `staff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.slice(0, 20);
  }

  // Check email uniqueness if provided
  if (email) {
    const { rows: emailCheck } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (emailCheck.length > 0) throw new AppError('Email already in use.', 409, 'EMAIL_TAKEN');
  }
  // Check phone uniqueness
  const { rows: phoneCheck } = await pool.query('SELECT id FROM users WHERE phone = $1', [finalPhone]);
  if (phoneCheck.length > 0) throw new AppError('Phone already in use.', 409, 'PHONE_TAKEN');

  const passwordHash = await bcrypt.hash(password, 12);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: userRows } = await client.query(
      `INSERT INTO users (phone, email, full_name, password_hash, password_plain, role, is_active)
       VALUES ($1, $2, $3, $4, NULL, $5, true)
       RETURNING id, phone, email, full_name, role, is_active`,
      [finalPhone, email || null, fullName || null, passwordHash, role],
    );
    const u = userRows[0];

    await client.query(
      `INSERT INTO admin_user (user_id, admin_role, full_name, allowed_pages)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET admin_role = $2, full_name = $3, allowed_pages = $4::jsonb`,
      [u.id, role, fullName || null, JSON.stringify(allowedPages || [])],
    );

    await client.query('COMMIT');
    return {
      id: u.id, phone: u.phone, email: u.email, fullName: u.full_name, role: u.role,
      isActive: u.is_active, allowedPages: allowedPages || [],
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Update a staff user's profile / role / allowed pages.
 */
async function updateStaffUser(id, { fullName, email, role, allowedPages }) {
  if (role && !STAFF_ROLES.includes(role)) {
    throw new AppError('Invalid staff role.', 400, 'INVALID_ROLE');
  }
  if (email) {
    const { rows: emailCheck } = await pool.query('SELECT id FROM users WHERE email = $1 AND id <> $2', [email, id]);
    if (emailCheck.length > 0) throw new AppError('Email already in use.', 409, 'EMAIL_TAKEN');
  }

  await pool.query(
    `UPDATE users
     SET full_name = COALESCE($1, full_name),
         email     = COALESCE($2, email),
         role      = COALESCE($3, role),
         updated_at = NOW()
     WHERE id = $4`,
    [fullName, email, role, id],
  );

  await pool.query(
    `INSERT INTO admin_user (user_id, admin_role, full_name, allowed_pages)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (user_id) DO UPDATE
     SET admin_role = COALESCE($2, admin_user.admin_role),
         full_name = COALESCE($3, admin_user.full_name),
         allowed_pages = COALESCE($4::jsonb, admin_user.allowed_pages),
         updated_at = NOW()`,
    [id, role, fullName, allowedPages ? JSON.stringify(allowedPages) : null],
  );

  return getStaffUser(id);
}

/**
 * Activate / block a staff user.
 */
async function setStaffUserStatus(id, { block, reason }) {
  const { rowCount } = await pool.query(
    `UPDATE users
     SET is_active = $1,
         is_blocked = $2,
         block_reason = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [!block, block, reason ?? null, id],
  );
  if (rowCount === 0) throw new AppError('User not found.', 404, 'NOT_FOUND');
}

async function getStaffUser(id) {
  const { rows } = await pool.query(
    `SELECT u.id, u.phone, u.email, u.full_name, u.role, u.is_active, u.is_blocked,
            au.allowed_pages, u.last_login
     FROM users u
     LEFT JOIN admin_user au ON au.user_id = u.id
     WHERE u.id = $1`,
    [id],
  );
  if (rows.length === 0) throw new AppError('User not found.', 404, 'NOT_FOUND');
  const r = rows[0];
  return {
    id: r.id, fullName: r.full_name, email: r.email, phone: r.phone, role: r.role,
    isActive: r.is_active, isBlocked: r.is_blocked,
    allowedPages: Array.isArray(r.allowed_pages) ? r.allowed_pages : [],
    lastLogin: r.last_login,
  };
}

/**
 * Reset a staff user's password.
 */
async function resetStaffPassword(id, newPassword) {
  assertStrongStaffPassword(newPassword);
  const hash = await bcrypt.hash(newPassword, 12);
  const { rowCount } = await pool.query(
    `UPDATE users SET password_hash = $1, password_plain = NULL, updated_at = NOW() WHERE id = $2`,
    [hash, id],
  );
  if (rowCount === 0) throw new AppError('User not found.', 404, 'NOT_FOUND');
}

module.exports = {
  STAFF_ROLES,
  listStaffUsers,
  createStaffUser,
  updateStaffUser,
  setStaffUserStatus,
  getStaffUser,
  resetStaffPassword,
};
