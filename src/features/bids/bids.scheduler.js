const { pool } = require('../../core/config/database');
const { sendPush } = require('../../core/config/firebase');
const { resolveWinner } = require('./bids.service');

const REMINDER_THRESHOLDS = [
  { key: '3d', label: '3 days', ms: 3 * 24 * 60 * 60 * 1000 },
  { key: '2d', label: '2 days', ms: 2 * 24 * 60 * 60 * 1000 },
  { key: '1d', label: '1 day', ms: 24 * 60 * 60 * 1000 },
  { key: '9h', label: '9 hours', ms: 9 * 60 * 60 * 1000 },
  { key: '6h', label: '6 hours', ms: 6 * 60 * 60 * 1000 },
  { key: '3h', label: '3 hours', ms: 3 * 60 * 60 * 1000 },
  { key: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
  { key: '10m', label: '10 minutes', ms: 10 * 60 * 1000 },
];

function dueReminder(remainingMs) {
  if (remainingMs <= 0) return null;
  for (let i = 0; i < REMINDER_THRESHOLDS.length; i += 1) {
    const threshold = REMINDER_THRESHOLDS[i];
    const nextThreshold = REMINDER_THRESHOLDS[i + 1];
    if (
      remainingMs <= threshold.ms &&
      (!nextThreshold || remainingMs > nextThreshold.ms)
    ) {
      return threshold;
    }
  }
  return null;
}

async function ensureSchedulerSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bid_notification_events (
      bid_id UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_key VARCHAR(32) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (bid_id, user_id, event_key)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bid_notification_closures (
      bid_id UUID PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function notifyOnce({ bidId, userId, eventKey, title, body, type }) {
  const client = await pool.connect();
  let token = null;
  let inserted = false;
  const data = {
    type,
    bidId,
    auctionId: bidId,
    eventKey,
    channelId: 'eco_orders',
    targetRoute: '/ema-bid',
  };

  try {
    await client.query('BEGIN');
    const claim = await client.query(
      `INSERT INTO bid_notification_events (bid_id, user_id, event_key)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING bid_id`,
      [bidId, userId, eventKey],
    );
    if (claim.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query(
      `INSERT INTO notifications (user_id, title, body, type, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, title, body, type, JSON.stringify(data)],
    );
    const user = await client.query(
      'SELECT fcm_token FROM users WHERE id = $1',
      [userId],
    );
    token = user.rows[0]?.fcm_token ?? null;
    await client.query('COMMIT');
    inserted = true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (inserted && token) {
    const pushResult = await sendPush(token, { title, body }, data);
    if (pushResult === 'INVALID_TOKEN') {
      await pool.query(
        'UPDATE users SET fcm_token = NULL, updated_at = NOW() WHERE id = $1',
        [userId],
      );
    }
  }
  return inserted;
}

async function sendReminders(now) {
  const { rows: bids } = await pool.query(
    `SELECT id, title, ends_at
       FROM bids
      WHERE status <> 'CANCELLED'
        AND starts_at <= $1
        AND ends_at > $1
        AND ends_at <= $1 + INTERVAL '3 days'
      ORDER BY ends_at`,
    [now],
  );

  for (const bid of bids) {
    const remainingMs = new Date(bid.ends_at).getTime() - now.getTime();
    const threshold = dueReminder(remainingMs);
    if (!threshold) continue;

    const { rows: participants } = await pool.query(
      `SELECT DISTINCT be.user_id
         FROM bid_entries be
        WHERE be.bid_id = $1
          AND NOT EXISTS (
            SELECT 1
              FROM bid_notification_events e
             WHERE e.bid_id = be.bid_id
               AND e.user_id = be.user_id
               AND e.event_key = $2
          )`,
      [bid.id, `reminder:${threshold.key}`],
    );

    for (const participant of participants) {
      await notifyOnce({
        bidId: bid.id,
        userId: participant.user_id,
        eventKey: `reminder:${threshold.key}`,
        title: 'Auction ending soon',
        body: `Your bid on "${bid.title}" ends in ${threshold.label}. Open Ema Bid before time runs out.`,
        type: 'BID_REMINDER',
      });
    }
  }
}

async function sendResults(now) {
  const { rows: bids } = await pool.query(
    `SELECT b.id, b.title
       FROM bids b
       LEFT JOIN bid_notification_closures c ON c.bid_id = b.id
      WHERE b.status <> 'CANCELLED'
        AND b.ends_at <= $1
        AND c.bid_id IS NULL
      ORDER BY b.ends_at`,
    [now],
  );

  for (const bid of bids) {
    const { rows: entries } = await pool.query(
      `SELECT user_id, amount
         FROM bid_entries
        WHERE bid_id = $1
        ORDER BY placed_at`,
      [bid.id],
    );
    const { winnerUserId, winnerAmount } = resolveWinner(entries);
    const participants = [...new Set(entries.map((entry) => String(entry.user_id)))];

    for (const userId of participants) {
      const isWinner = winnerUserId != null &&
        userId === String(winnerUserId);
      const amount = winnerAmount == null ? '' : ` at ETB ${winnerAmount.toFixed(2)}`;
      await notifyOnce({
        bidId: bid.id,
        userId,
        eventKey: isWinner ? 'result:win' : 'result:loss',
        title: isWinner ? 'You won the auction!' : 'Auction ended',
        body: isWinner
          ? `Congratulations! You won "${bid.title}"${amount}.`
          : `The auction "${bid.title}" has ended. You did not win this time.`,
        type: isWinner ? 'AUCTION_WIN' : 'AUCTION_LOSS',
      });
    }

    await pool.query(
      `INSERT INTO bid_notification_closures (bid_id)
       VALUES ($1)
       ON CONFLICT (bid_id) DO NOTHING`,
      [bid.id],
    );
  }
}

let running = false;

async function processBidNotifications() {
  if (running) return;
  running = true;
  try {
    await ensureSchedulerSchema();
    const { rows } = await pool.query('SELECT NOW() AS now');
    const now = rows[0].now;
    await sendReminders(now);
    await sendResults(now);
  } finally {
    running = false;
  }
}

module.exports = { dueReminder, processBidNotifications };
