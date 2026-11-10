/**
 * Auth security migration — idempotent, safe to run many times, ONE transaction.
 *
 *   node scripts/migrate-auth-security.js
 *
 * Run it BEFORE deploying the new auth code. The new login/OTP code reads
 * columns and tables that this script creates.
 */
const { pool } = require('../src/core/config/database');

async function columnType(client, table, column) {
  const { rows } = await client.query(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows[0] ? rows[0].data_type : null;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // users.id decides the type of every user_id column we add.
    const idType = await columnType(client, 'users', 'id');
    if (!idType) throw new Error('users.id not found — is this the right database?');
    const uid = idType === 'uuid' ? 'UUID' : idType === 'integer' ? 'INTEGER' : 'BIGINT';
    console.log(`OK: users.id is ${idType}`);

    // 1. OTPs: hashed storage + the password chosen at sign-up
    await client.query(`ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS code_hash TEXT`);
    await client.query(`ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS pending_password_hash TEXT`);
    await client.query(`ALTER TABLE otp_codes ALTER COLUMN code DROP NOT NULL`);
    // Plain-text codes must not survive: invalidate and wipe every one.
    await client.query(`UPDATE otp_codes SET is_used = true, code = NULL WHERE code IS NOT NULL`);
    console.log('OK: otp_codes hashed storage, old plaintext codes wiped');

    // 2. users: lockout + session invalidation on password change
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ`);
    console.log('OK: users lockout columns');

    // 3. refresh tokens (stored only as SHA-256 hashes)
    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     ${uid} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash  TEXT NOT NULL UNIQUE,
        family_id   UUID NOT NULL,
        expires_at  TIMESTAMPTZ NOT NULL,
        revoked_at  TIMESTAMPTZ,
        replaced_by UUID,
        user_agent  TEXT,
        ip          TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens (family_id)`);
    console.log('OK: refresh_tokens');

    // 4. audit log (masked phones only — never secrets)
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_audit_log (
        id           BIGSERIAL PRIMARY KEY,
        user_id      ${uid},
        event        TEXT NOT NULL,
        phone_masked TEXT,
        ip           TEXT,
        user_agent   TEXT,
        meta         JSONB,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS auth_audit_log_created_idx ON auth_audit_log (created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS auth_audit_log_user_idx ON auth_audit_log (user_id, created_at)`);
    console.log('OK: auth_audit_log');

    // 5. one Telegram chat per phone (the link endpoint relies on this)
    const { rows: hasUnique } = await client.query(
      `SELECT 1 FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
        WHERE t.relname = 'telegram_chat_ids' AND c.contype IN ('u', 'p') AND a.attname = 'phone'`,
    );
    if (hasUnique.length === 0) {
      await client.query(
        `ALTER TABLE telegram_chat_ids ADD CONSTRAINT telegram_chat_ids_phone_key UNIQUE (phone)`,
      );
      console.log('OK: telegram_chat_ids unique(phone) added');
    } else {
      console.log('OK: telegram_chat_ids unique(phone) already present');
    }

    await client.query('COMMIT');
    console.log('Done.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration FAILED (rolled back):', err.code || err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
