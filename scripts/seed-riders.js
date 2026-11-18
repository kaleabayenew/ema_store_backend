/**
 * Seed demo delivery riders into delivery_agents.
 * Idempotent: skips phones that already have an account.
 * Also gives any agent missing a password the default demo password.
 *
 * Run:  node scripts/seed-riders.js
 */
const bcrypt = require('bcryptjs');
const { pool } = require('../src/core/config/database');
const { register, ensureAgentAuthSchema, normalizeEtPhone } = require('../src/features/agent_auth/agent_auth.service');

const DEFAULT_PASSWORD = 'Rider@123';

const RIDERS = [
  {
    fullName: 'Abebe Kebede', phone: '0911000101', nationalId: 'ETH-1001',
    licenseNumber: 'DL-88001', vehicleType: 'motorbike', plateNumber: 'AA 1010',
    emergencyContact: '0911000201', emergencyNationalId: 'ETH-EMG1',
  },
  {
    fullName: 'Tigist Haile', phone: '0911000102', nationalId: 'ETH-1002',
    licenseNumber: 'DL-88002', vehicleType: 'bicycle', plateNumber: 'AA 1011',
    emergencyContact: '0911000202', emergencyNationalId: 'ETH-EMG2',
  },
  {
    fullName: 'Dawit Alemu', phone: '0911000103', nationalId: 'ETH-1003',
    licenseNumber: 'DL-88003', vehicleType: 'car', plateNumber: 'AA 3-1012',
    emergencyContact: '0911000203', emergencyNationalId: 'ETH-EMG3',
  },
  {
    fullName: 'Hanna Girma', phone: '0911000104', nationalId: 'ETH-1004',
    licenseNumber: 'DL-88004', vehicleType: 'motorbike', plateNumber: 'AA 1013',
    emergencyContact: '0911000204', emergencyNationalId: 'ETH-EMG4',
  },
  {
    fullName: 'Yonas Tadesse', phone: '0911000105', nationalId: 'ETH-1005',
    licenseNumber: 'DL-88005', vehicleType: 'motorbike', plateNumber: 'AA 1014',
    emergencyContact: '0911000205', emergencyNationalId: 'ETH-EMG5',
  },
];

async function main() {
  await ensureAgentAuthSchema();

  for (const r of RIDERS) {
    try {
      const res = await register({ ...r, password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD });
      console.log(`created  ${res.agent.agentCode}  ${res.agent.fullName}  ${res.agent.phone}`);
    } catch (err) {
      if (err.code === 'PHONE_TAKEN' || err.code === 'NATIONAL_ID_TAKEN') {
        console.log(`exists   ${r.fullName} (${r.phone}) — skipped`);
      } else {
        console.log(`error    ${r.fullName}: ${err.code} ${err.message}`);
      }
    }
  }

  // Give passwordless agents (e.g. manually inserted RIDER-001) a login password.
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const { rowCount } = await pool.query(
    `UPDATE delivery_agents SET password_hash = $1
     WHERE password_hash IS NULL`,
    [hash],
  );
  if (rowCount > 0) console.log(`set default password on ${rowCount} agent(s)`);

  const { rows } = await pool.query(
    `SELECT agent_code, full_name, phone, is_active,
            (password_hash IS NOT NULL) AS has_password
     FROM delivery_agents ORDER BY created_at`,
  );
  console.table(rows);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
