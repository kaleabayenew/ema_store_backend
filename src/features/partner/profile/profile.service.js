const { pool } = require('../../../core/config/database');
const { AppError } = require('../../../core/errors/app_error');

async function getProfile(userId) {
  const { rows } = await pool.query(
    `SELECT pp.*,
       COALESCE((SELECT SUM(amount) FROM wallet_transactions WHERE user_id = $1), 0)::bigint AS balance_cents
     FROM partner_profile pp WHERE pp.user_id = $1`,
    [userId],
  );
  if (rows.length === 0) throw new AppError('Profile not found.', 404, 'PROFILE_NOT_FOUND');
  return rows[0];
}

async function updateProfile(userId, data) {
  const ALLOWED = ['shop_name', 'owner_name', 'description', 'address', 'delivery_areas', 'city', 'phone', 'email',
                    'bank_name', 'account_number', 'telebirr_phone', 'is_open', 'opening_days'];
  const fields = [];
  const values = [];
  let idx = 1;

  for (const key of ALLOWED) {
    if (data[key] !== undefined) {
      fields.push(`${key} = $${idx}`);
      values.push(data[key]);
      idx++;
    }
  }

  if (fields.length === 0) throw new AppError('No valid fields to update.', 400, 'NO_FIELDS');

  values.push(userId);
  const { rows } = await pool.query(
    `UPDATE partner_profile SET ${fields.join(', ')}, updated_at = NOW()
     WHERE user_id = $${idx}
     RETURNING *`,
    values,
  );
  if (rows.length === 0) throw new AppError('Profile not found.', 404, 'PROFILE_NOT_FOUND');
  return rows[0];
}

async function updateLogo(userId, logoUrl) {
  const { rows } = await pool.query(
    `UPDATE partner_profile SET logo_url = $1, updated_at = NOW()
     WHERE user_id = $2
     RETURNING *`,
    [logoUrl, userId],
  );
  if (rows.length === 0) throw new AppError('Profile not found.', 404, 'PROFILE_NOT_FOUND');
  return rows[0];
}

module.exports = { getProfile, updateProfile, updateLogo };
