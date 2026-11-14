const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');
const { sendMulticastPush } = require('../../core/config/firebase');
const telegramBot = require('../../core/services/telegram-bot.service');

// ─────────────────────────────────────────────────────────────────────────────
//  Announcements — admin-composed broadcasts.
//
//  Audience is a subset of app roles: CUSTOMER | PARTNER | RIDE.
//  Lifecycle: DRAFT → SCHEDULED (scheduled_at in future) → SENDING → SENT.
//  Dispatch writes one `notifications` row per recipient (in-app inbox + FCM
//  push) and sends a Telegram message to every linked chat_id.
// ─────────────────────────────────────────────────────────────────────────────

const AUDIENCES = ['CUSTOMER', 'PARTNER', 'RIDE'];
const MAX_TITLE = 200;
const MAX_BODY = 4000;
const TELEGRAM_BATCH = 25;
const FCM_BATCH = 500;

let tableReady = null;

async function ensureTable() {
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        audience JSONB NOT NULL DEFAULT '["CUSTOMER"]'::jsonb,
        status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        scheduled_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        created_by UUID,
        stats JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => {
      // Allow re-dispatch of failed sends by admins.
      return pool.query(`CREATE INDEX IF NOT EXISTS idx_announcements_due
        ON announcements (status, scheduled_at) WHERE status = 'SCHEDULED'`);
    });
  }
  return tableReady;
}

function validateAudience(audience) {
  if (!Array.isArray(audience) || audience.length === 0) {
    throw new AppError('Select at least one audience.', 400, 'INVALID_AUDIENCE');
  }
  const clean = [...new Set(audience.map((a) => String(a).toUpperCase()))];
  if (clean.some((a) => !AUDIENCES.includes(a))) {
    throw new AppError(`Audience must be one of: ${AUDIENCES.join(', ')}.`, 400, 'INVALID_AUDIENCE');
  }
  return clean;
}

function validateContent(title, body) {
  if (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > MAX_TITLE) {
    throw new AppError(`Title must be 3-${MAX_TITLE} characters.`, 400, 'INVALID_TITLE');
  }
  if (typeof body !== 'string' || body.trim().length < 1 || body.trim().length > MAX_BODY) {
    throw new AppError(`Message must be 1-${MAX_BODY} characters.`, 400, 'INVALID_BODY');
  }
  return { title: title.trim(), body: body.trim() };
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function listAnnouncements({ page = 1, limit = 20, status } = {}) {
  await ensureTable();
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const where = [];
  const params = [];
  if (status && ['DRAFT', 'SCHEDULED', 'SENDING', 'SENT'].includes(status)) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM announcements ${whereSql}`,
    params,
  );
  params.push(l, (p - 1) * l);
  const { rows } = await pool.query(
    `SELECT id, title, body, audience, status, scheduled_at, sent_at,
            created_by, stats, created_at, updated_at
       FROM announcements ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { announcements: rows, total: totalRows[0].total, page: p, limit: l };
}

async function getAnnouncement(id) {
  await ensureTable();
  const { rows } = await pool.query('SELECT * FROM announcements WHERE id = $1', [id]);
  if (!rows[0]) throw new AppError('Announcement not found.', 404, 'NOT_FOUND');
  return rows[0];
}

// ── Writes ───────────────────────────────────────────────────────────────────

async function createAnnouncement({ title, body, audience, action, scheduledAt, createdBy }) {
  await ensureTable();
  const { title: t, body: b } = validateContent(title, body);
  const aud = validateAudience(audience);
  const act = ['draft', 'schedule', 'send'].includes(action) ? action : 'draft';

  let status = 'DRAFT';
  let scheduled = null;
  if (act === 'schedule') {
    const when = scheduledAt ? new Date(scheduledAt) : null;
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      throw new AppError('Schedule time must be in the future.', 400, 'INVALID_SCHEDULE');
    }
    status = 'SCHEDULED';
    scheduled = when.toISOString();
  }

  const { rows } = await pool.query(
    `INSERT INTO announcements (title, body, audience, status, scheduled_at, created_by)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     RETURNING *`,
    [t, b, JSON.stringify(aud), status, scheduled, createdBy || null],
  );

  const ann = rows[0];
  if (act === 'send') {
    return dispatchAnnouncement(ann.id);
  }
  return ann;
}

async function updateAnnouncement(id, { title, body, audience, action, scheduledAt }) {
  const existing = await getAnnouncement(id);
  if (!['DRAFT', 'SCHEDULED'].includes(existing.status)) {
    throw new AppError('Only draft or scheduled announcements can be edited.', 409, 'NOT_EDITABLE');
  }
  const t = title !== undefined ? title : existing.title;
  const b = body !== undefined ? body : existing.body;
  const aud = audience !== undefined ? validateAudience(audience) : existing.audience;
  const { title: ct, body: cb } = validateContent(t, b);

  let status = existing.status;
  let scheduled = existing.scheduled_at;
  const act = action || (scheduledAt !== undefined ? 'schedule' : null);
  if (act === 'schedule' || scheduledAt !== undefined) {
    const when = scheduledAt ? new Date(scheduledAt) : null;
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      throw new AppError('Schedule time must be in the future.', 400, 'INVALID_SCHEDULE');
    }
    status = 'SCHEDULED';
    scheduled = when.toISOString();
  } else if (act === 'draft') {
    status = 'DRAFT';
    scheduled = null;
  }

  const { rows } = await pool.query(
    `UPDATE announcements
        SET title = $2, body = $3, audience = $4::jsonb, status = $5,
            scheduled_at = $6, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, ct, cb, JSON.stringify(aud), status, scheduled],
  );
  return rows[0];
}

async function deleteAnnouncement(id) {
  const existing = await getAnnouncement(id);
  if (existing.status === 'SENT' || existing.status === 'SENDING') {
    throw new AppError('Sent announcements cannot be deleted.', 409, 'NOT_DELETABLE');
  }
  await pool.query('DELETE FROM announcements WHERE id = $1', [id]);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Claim and send an announcement. The status flip to SENDING is atomic so a
 * scheduler tick and a manual publish cannot double-send.
 */
async function dispatchAnnouncement(id) {
  const { rows: claimed } = await pool.query(
    `UPDATE announcements
        SET status = 'SENDING', updated_at = NOW()
      WHERE id = $1 AND status IN ('DRAFT', 'SCHEDULED')
      RETURNING *`,
    [id],
  );
  const ann = claimed[0];
  if (!ann) {
    const existing = await getAnnouncement(id);
    if (existing.status === 'SENT') return existing;
    throw new AppError('Announcement is already being sent.', 409, 'ALREADY_SENDING');
  }

  const stats = await deliver(ann);

  const { rows } = await pool.query(
    `UPDATE announcements
        SET status = 'SENT', sent_at = NOW(), stats = $2::jsonb, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(stats)],
  );
  return rows[0];
}

/** Scheduler entry point — sends everything whose time has come. */
async function processDueAnnouncements() {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT id FROM announcements
      WHERE status = 'SCHEDULED' AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC LIMIT 20`,
  );
  for (const row of rows) {
    try {
      await dispatchAnnouncement(row.id);
    } catch (err) {
      console.error('[announcements] dispatch failed:', err.code || err.name);
    }
  }
  return rows.length;
}

// ── Delivery internals ───────────────────────────────────────────────────────

async function fetchRecipients(audience) {
  const { rows } = await pool.query(
    `SELECT id, phone, fcm_token
       FROM users
      WHERE role = ANY($1::text[])
        AND is_active = true
        AND COALESCE(is_blocked, false) = false`,
    [audience],
  );
  return rows;
}

async function deliver(ann) {
  const audience = Array.isArray(ann.audience) ? ann.audience : JSON.parse(ann.audience || '[]');
  const recipients = await fetchRecipients(audience);
  const stats = {
    audience,
    recipients: recipients.length,
    notified: 0,
    pushed: 0,
    telegramSent: 0,
    telegramFailed: 0,
    telegramSkipped: 0,
  };
  if (recipients.length === 0) return stats;

  // 1. In-app notification rows (one per recipient).
  const dataJson = JSON.stringify({ announcementId: ann.id, type: 'ANNOUNCEMENT' });
  const { rowCount } = await pool.query(
    `INSERT INTO notifications (user_id, title, body, data, type)
     SELECT id, $2, $3, $4::jsonb, 'ANNOUNCEMENT'
       FROM users
      WHERE id = ANY($1::uuid[])`,
    [recipients.map((r) => r.id), ann.title, ann.body, dataJson],
  );
  stats.notified = rowCount || 0;

  // 2. FCM multicast in batches.
  const tokens = recipients.map((r) => r.fcm_token).filter(Boolean);
  for (let i = 0; i < tokens.length; i += FCM_BATCH) {
    const res = await sendMulticastPush(
      tokens.slice(i, i + FCM_BATCH),
      { title: ann.title, body: ann.body },
      { type: 'ANNOUNCEMENT', announcementId: ann.id, channelId: 'eco_announcements' },
    );
    stats.pushed += res.successCount || 0;
  }

  // 3. Telegram broadcast to linked chat ids.
  const { rows: chats } = await pool.query(
    `SELECT tc.chat_id
       FROM telegram_chat_ids tc
       JOIN users u ON u.phone = tc.phone
      WHERE u.id = ANY($1::uuid[])`,
    [recipients.map((r) => r.id)],
  );
  stats.telegramSkipped = recipients.length - chats.length;
  for (let i = 0; i < chats.length; i += TELEGRAM_BATCH) {
    const batch = chats.slice(i, i + TELEGRAM_BATCH);
    const results = await Promise.allSettled(
      batch.map((c) => telegramBot.sendAnnouncement(c.chat_id, ann.title, ann.body)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.success) stats.telegramSent += 1;
      else stats.telegramFailed += 1;
    }
  }

  return stats;
}

module.exports = {
  AUDIENCES,
  ensureTable,
  listAnnouncements,
  getAnnouncement,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  dispatchAnnouncement,
  processDueAnnouncements,
};
