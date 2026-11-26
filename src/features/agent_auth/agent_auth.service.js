const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../../core/config/database');
const { jwtSecret } = require('../../core/config');
const { AppError } = require('../../core/errors/app_error');
const { ensureOrderFlowSchema } = require('../orders/order_flow');

const BCRYPT_COST = 10;
const TOKEN_TTL = '30d';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

let schemaPromise = null;

/** Extends delivery_agents with rider profile + credential columns. */
function ensureAgentAuthSchema(db = pool) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensureOrderFlowSchema(db);
      await db.query(`ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`);
      await db.query(`ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS national_id VARCHAR(50)`);
      await db.query(`ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS license_number VARCHAR(50)`);
      await db.query(`ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(30)`);
      await db.query(`ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS plate_number VARCHAR(20)`);
      await db.query(`ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(30)`);
      await db.query(`ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS emergency_national_id VARCHAR(50)`);
      await db.query(`ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'APPROVED'`);
      await db.query(`ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS photo_url TEXT`);
      await db.query(`ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS sub_city VARCHAR(120)`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS agent_profile_requests (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID NOT NULL REFERENCES delivery_agents(id) ON DELETE CASCADE,
          fields JSONB NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
          reviewer_note TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          reviewed_at TIMESTAMP WITH TIME ZONE
        )
      `);
      await db.query(
        `CREATE INDEX IF NOT EXISTS idx_agent_profile_requests_agent
         ON agent_profile_requests(agent_id, created_at DESC)`,
      );
      await db.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_agents_phone
         ON delivery_agents(phone) WHERE phone IS NOT NULL`,
      );
      await db.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_agents_national_id
         ON delivery_agents(national_id) WHERE national_id IS NOT NULL`,
      );
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

function generateAgentCode() {
  const bytes = crypto.randomBytes(6);
  let out = 'R';
  for (let i = 0; i < 6; i++) out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return out;
}

// Ethiopian mobile: 9 digits starting with 7 or 9. Accepts +251…, 251…,
// 09… and bare 9-digit input; returns canonical '+251XXXXXXXXX' or null.
function normalizeEtPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('251')) d = d.slice(3);
  if (d.startsWith('0') && d.length === 10) d = d.slice(1);
  if (!/^[79]\d{8}$/.test(d)) return null;
  return `+251${d}`;
}

// All DB representations a phone could have been stored as.
function phoneVariants(canonical) {
  const d = canonical.slice(4); // strip '+251'
  return [canonical, `0${d}`, `251${d}`, d];
}

function signAgentToken(agent) {
  return jwt.sign(
    { sub: agent.id, agentCode: agent.agent_code, type: 'AGENT_AUTH' },
    jwtSecret,
    { expiresIn: TOKEN_TTL },
  );
}

function publicAgent(a) {
  return {
    id: a.id,
    agentCode: a.agent_code,
    fullName: a.full_name,
    phone: a.phone || null,
    nationalId: a.national_id || null,
    licenseNumber: a.license_number || null,
    vehicleType: a.vehicle_type || null,
    plateNumber: a.plate_number || null,
    emergencyContact: a.emergency_contact || null,
    emergencyNationalId: a.emergency_national_id || null,
    photoUrl: a.photo_url || null,
    subCity: a.sub_city || null,
    isActive: a.is_active !== false,
    approvalStatus: a.approval_status || 'APPROVED',
    createdAt: a.created_at,
  };
}

async function register(body = {}) {
  await ensureAgentAuthSchema();

  const fullName = String(body.fullName || body.full_name || '').trim();
  const phone = normalizeEtPhone(body.phone);
  const password = String(body.password || '');
  const confirmPassword = String(body.confirmPassword || body.confirm_password || '');
  const emergencyContactRaw = String(body.emergencyContact || body.emergency_contact || '').trim();
  const emergencyContact = emergencyContactRaw ? (normalizeEtPhone(emergencyContactRaw) || emergencyContactRaw) : null;
  const emergencyNationalId = String(body.emergencyNationalId || body.emergency_national_id || '').trim() || null;
  const nationalId = String(body.nationalId || body.national_id || '').trim() || null;
  const licenseNumber = String(body.licenseNumber || body.license_number || '').trim() || null;
  const vehicleType = String(body.vehicleType || body.vehicle_type || '').trim().toLowerCase() || null;
  const plateNumber = String(body.plateNumber || body.plate_number || '').trim().toUpperCase() || null;

  if (!fullName) throw new AppError('Full name is required.', 400, 'NAME_REQUIRED');
  if (!phone) {
    throw new AppError('Enter a valid Ethiopian phone number: 9 digits starting with 7 or 9.', 400, 'PHONE_INVALID');
  }
  if (password.length < 6) {
    throw new AppError('Password must be at least 6 characters.', 400, 'WEAK_PASSWORD');
  }
  if (password !== confirmPassword) {
    throw new AppError('Passwords do not match.', 400, 'PASSWORD_MISMATCH');
  }
  if (!nationalId) throw new AppError('National ID is required.', 400, 'NATIONAL_ID_REQUIRED');
  if (!licenseNumber) throw new AppError('License number is required.', 400, 'LICENSE_REQUIRED');
  if (!vehicleType) throw new AppError('Vehicle type is required.', 400, 'VEHICLE_REQUIRED');
  if (!plateNumber) throw new AppError('Plate number is required.', 400, 'PLATE_REQUIRED');

  const allowedVehicles = ['motorbike', 'bicycle', 'car'];
  const normalizedVehicle = vehicleType;
  if (!allowedVehicles.includes(normalizedVehicle)) {
    throw new AppError('Invalid vehicle type.', 400, 'INVALID_VEHICLE');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  // Retry a few times on the (astronomically rare) agent_code collision.
  let agent = null;
  for (let attempt = 0; attempt < 5 && !agent; attempt++) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO delivery_agents
           (agent_code, full_name, phone, password_hash, national_id, license_number,
            vehicle_type, plate_number, emergency_contact, emergency_national_id,
            is_active, approval_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,'APPROVED')
         RETURNING *`,
        [
          generateAgentCode(), fullName, phone, passwordHash, nationalId,
          licenseNumber, normalizedVehicle, plateNumber,
          emergencyContact, emergencyNationalId,
        ],
      );
      agent = rows[0];
    } catch (err) {
      if (err && err.code === '23505') {
        const detail = String(err.detail || '');
        if (detail.includes('phone')) {
          throw new AppError('An account with this phone number already exists. Please log in.', 409, 'PHONE_TAKEN');
        }
        if (detail.includes('national_id')) {
          throw new AppError('This national ID is already registered.', 409, 'NATIONAL_ID_TAKEN');
        }
        continue; // agent_code collision — retry
      }
      throw err;
    }
  }
  if (!agent) throw new AppError('Could not generate a unique agent code. Try again.', 500, 'CODE_GENERATION_FAILED');

  return {
    token: signAgentToken(agent),
    agent: publicAgent(agent),
  };
}

async function login(phoneRaw, passwordRaw) {
  await ensureAgentAuthSchema();
  const phone = normalizeEtPhone(phoneRaw);
  const password = String(passwordRaw || '');
  if (!phone || !password) {
    throw new AppError('Phone number and password are required.', 400, 'CREDENTIALS_REQUIRED');
  }

  const { rows } = await pool.query(
    `SELECT * FROM delivery_agents WHERE phone = ANY($1)`,
    [phoneVariants(phone)],
  );
  const agent = rows[0];

  // Always run bcrypt to keep timing similar whether or not the account exists.
  const hash = agent?.password_hash || bcrypt.hashSync('dummy', BCRYPT_COST);
  const match = await bcrypt.compare(password, hash);
  if (!agent || !match) {
    throw new AppError('Invalid phone number or password.', 401, 'INVALID_CREDENTIALS');
  }
  if (agent.is_active === false) {
    throw new AppError('This account has been deactivated. Contact support.', 403, 'AGENT_INACTIVE');
  }

  return {
    token: signAgentToken(agent),
    agent: publicAgent(agent),
  };
}

async function me(agentId) {
  await ensureAgentAuthSchema();
  const { rows } = await pool.query(
    `SELECT * FROM delivery_agents WHERE id = $1`,
    [agentId],
  );
  if (!rows[0]) throw new AppError('Agent not found.', 404, 'AGENT_NOT_FOUND');
  return publicAgent(rows[0]);
}

async function updateFcmToken(agentId, rawToken) {
  await ensureAgentAuthSchema();
  const token = String(rawToken || '').trim();
  if (!token || token.length > 4096) {
    throw new AppError('A valid FCM token is required.', 400, 'INVALID_FCM_TOKEN');
  }
  await pool.query(
    `UPDATE delivery_agents SET fcm_token = $2 WHERE id = $1`,
    [agentId, token],
  );
  return { registered: true };
}

async function clearFcmToken(agentId) {
  await ensureAgentAuthSchema();
  await pool.query(
    `UPDATE delivery_agents SET fcm_token = NULL WHERE id = $1`,
    [agentId],
  );
  return { registered: false };
}

// ── Profile change requests (rider edits → admin approval) ────────────────────

// App field name → delivery_agents column. Only these may be changed.
const PROFILE_FIELD_MAP = {
  fullName: 'full_name',
  phone: 'phone',
  emergencyContact: 'emergency_contact',
  emergencyNationalId: 'emergency_national_id',
  licenseNumber: 'license_number',
  vehicleType: 'vehicle_type',
  plateNumber: 'plate_number',
  photoUrl: 'photo_url',
  subCity: 'sub_city',
};

function sanitizeProfileFields(input = {}) {
  const out = {};
  for (const [key, col] of Object.entries(PROFILE_FIELD_MAP)) {
    const v = input[key];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) out[col] = s.slice(0, col === 'photo_url' ? 1000 : 255);
  }
  return out;
}

async function submitProfileRequest(agentId, input = {}) {
  await ensureAgentAuthSchema();
  const fields = sanitizeProfileFields(input);
  if (Object.keys(fields).length === 0) {
    throw new AppError('Nothing to update.', 400, 'NO_FIELDS');
  }
  // Phone must stay a valid Ethiopian number and unique.
  if (fields.phone) {
    const normalized = normalizeEtPhone(fields.phone);
    if (!normalized) {
      throw new AppError('Enter a valid Ethiopian phone number.', 400, 'PHONE_INVALID');
    }
    fields.phone = normalized;
    const { rows: dup } = await pool.query(
      `SELECT id FROM delivery_agents
       WHERE phone = ANY($1) AND id <> $2`,
      [phoneVariants(normalized), agentId],
    );
    if (dup[0]) {
      throw new AppError('This phone number is already used by another rider.', 409, 'PHONE_TAKEN');
    }
  }

  // One pending request per rider — replace it if they edit again.
  const { rows: existing } = await pool.query(
    `SELECT id FROM agent_profile_requests
     WHERE agent_id = $1 AND status = 'PENDING'
     ORDER BY created_at DESC LIMIT 1`,
    [agentId],
  );
  if (existing[0]) {
    const { rows } = await pool.query(
      `UPDATE agent_profile_requests
       SET fields = $2, created_at = NOW()
       WHERE id = $1 RETURNING *`,
      [existing[0].id, JSON.stringify(fields)],
    );
    return formatRequest(rows[0]);
  }
  const { rows } = await pool.query(
    `INSERT INTO agent_profile_requests (agent_id, fields)
     VALUES ($1, $2::jsonb) RETURNING *`,
    [agentId, JSON.stringify(fields)],
  );
  return formatRequest(rows[0]);
}

function formatRequest(r) {
  return {
    id: r.id,
    fields: r.fields || {},
    status: r.status,
    reviewerNote: r.reviewer_note || null,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
  };
}

async function getProfileRequest(agentId) {
  await ensureAgentAuthSchema();
  const { rows } = await pool.query(
    `SELECT * FROM agent_profile_requests
     WHERE agent_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [agentId],
  );
  return rows[0] ? formatRequest(rows[0]) : null;
}

async function listProfileRequests({ status = 'PENDING', limit = 100 } = {}) {
  await ensureAgentAuthSchema();
  const safeLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
  const { rows } = await pool.query(
    `SELECT r.*, a.agent_code, a.full_name AS agent_name, a.phone AS agent_phone
     FROM agent_profile_requests r
     JOIN delivery_agents a ON a.id = r.agent_id
     WHERE ($1::text IS NULL OR r.status = $1)
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [status || null, safeLimit],
  );
  return rows.map((r) => ({
    ...formatRequest(r),
    agent: {
      id: r.agent_id,
      agentCode: r.agent_code,
      name: r.agent_name,
      phone: r.agent_phone,
    },
  }));
}

async function reviewProfileRequest(requestId, { approve, note } = {}) {
  await ensureAgentAuthSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM agent_profile_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const req = rows[0];
    if (!req) throw new AppError('Request not found.', 404, 'REQUEST_NOT_FOUND');
    if (req.status !== 'PENDING') {
      throw new AppError('This request was already reviewed.', 409, 'ALREADY_REVIEWED');
    }

    const newStatus = approve ? 'APPROVED' : 'REJECTED';
    if (approve) {
      const sets = [];
      const params = [];
      for (const [col, val] of Object.entries(req.fields || {})) {
        if (!Object.values(PROFILE_FIELD_MAP).includes(col)) continue;
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
      if (sets.length > 0) {
        params.push(req.agent_id);
        await client.query(
          `UPDATE delivery_agents SET ${sets.join(', ')} WHERE id = $${params.length}`,
          params,
        );
      }
    }

    const { rows: updated } = await client.query(
      `UPDATE agent_profile_requests
       SET status = $2, reviewer_note = $3, reviewed_at = NOW()
       WHERE id = $1 RETURNING *`,
      [requestId, newStatus, note ? String(note).slice(0, 500) : null],
    );
    await client.query('COMMIT');
    return formatRequest(updated[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  register,
  login,
  me,
  updateFcmToken,
  clearFcmToken,
  submitProfileRequest,
  getProfileRequest,
  listProfileRequests,
  reviewProfileRequest,
  signAgentToken,
  ensureAgentAuthSchema,
  normalizeEtPhone,
};
