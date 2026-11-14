const { pool } = require('../../../core/config/database');

// Ensure tables exist
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_settings (
      user_id              UUID PRIMARY KEY REFERENCES users(id),
      notifications_enabled BOOLEAN DEFAULT true,
      order_alerts          BOOLEAN DEFAULT true,
      promo_alerts          BOOLEAN DEFAULT true
    )
  `);
}
ensureSchema().catch(err => console.warn('[Partner Settings] Schema init:', err.message));

async function getSettings(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM partner_settings WHERE user_id = $1`,
    [userId],
  );

  if (rows.length === 0) {
    // Insert defaults and return
    const { rows: newRows } = await pool.query(
      `INSERT INTO partner_settings (user_id) VALUES ($1) RETURNING *`,
      [userId],
    );
    return newRows[0];
  }

  return rows[0];
}

async function updateSettings(userId, data) {
  const { notificationsEnabled, orderAlerts, promoAlerts } = data;
  const { rows } = await pool.query(
    `INSERT INTO partner_settings (user_id, notifications_enabled, order_alerts, promo_alerts)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET notifications_enabled = EXCLUDED.notifications_enabled,
           order_alerts          = EXCLUDED.order_alerts,
           promo_alerts          = EXCLUDED.promo_alerts
     RETURNING *`,
    [
      userId,
      notificationsEnabled !== undefined ? notificationsEnabled : true,
      orderAlerts !== undefined ? orderAlerts : true,
      promoAlerts !== undefined ? promoAlerts : true,
    ],
  );
  return rows[0];
}

async function registerFcmToken(userId, token) {
  // Ensure a unique index on token alone exists (idempotent)
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_fcm_tokens_token ON fcm_tokens (token)`);
  } catch (e) { /* index may already exist with different constraint */ }

  const { rows } = await pool.query(
    `INSERT INTO fcm_tokens (user_id, token)
     VALUES ($1, $2)
     ON CONFLICT (user_id, token) DO UPDATE SET user_id = $1
     RETURNING *`,
    [userId, token],
  );
  // Keep users.fcm_token in sync so broadcast/push services
  // (announcements, notifications.service) reach this device too.
  await pool.query(`UPDATE users SET fcm_token = $2 WHERE id = $1`, [userId, token]);
  return rows[0];
}

module.exports = { getSettings, updateSettings, registerFcmToken };
