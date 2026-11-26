const { pool } = require('../../core/config/database');

// ── Contact / support channel settings (single 'default' row) ────────────────

const FIELDS = [
  'hotline_phone',
  'sos_phone',
  'telegram',
  'whatsapp',
  'facebook',
  'instagram',
  'email',
  'website',
  'address',
  'working_hours',
];

function rowToSettings(r) {
  if (!r) return defaultSettings();
  const out = {};
  for (const f of FIELDS) out[f] = r[f] ?? '';
  out.updated_at = r.updated_at;
  return out;
}

function defaultSettings() {
  const out = {};
  for (const f of FIELDS) out[f] = '';
  return out;
}

async function getContactSettings() {
  const { rows } = await pool.query(
    `SELECT * FROM contact_settings WHERE id = 'default'`,
  );
  return rowToSettings(rows[0]);
}

async function updateContactSettings(input = {}) {
  const sets = [];
  const params = [];
  for (const f of FIELDS) {
    if (input[f] !== undefined) {
      params.push(input[f] === null ? '' : String(input[f]).slice(0, 300));
      sets.push(`${f} = $${params.length}`);
    }
  }
  if (sets.length === 0) return getContactSettings();
  params.push('default');
  const { rows } = await pool.query(
    `UPDATE contact_settings SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return rowToSettings(rows[0]);
}

module.exports = { getContactSettings, updateContactSettings };
