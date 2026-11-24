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

module.exports = {
  register,
  login,
  me,
  updateFcmToken,
  clearFcmToken,
  signAgentToken,
  ensureAgentAuthSchema,
  normalizeEtPhone,
};
