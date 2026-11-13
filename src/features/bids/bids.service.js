const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ── Schema bootstrap ──────────────────────────────────────────────────────────
// Created lazily (same pattern as credits.service) so no change to app.js is
// needed. Safe to run many times.
//  • bid_entries.placed_at : older deployments created the column as bid_time.
//  • bid_holds             : money currently held from a bidder's wallet for an
//                            auction (the sum of that user's bid entries; only
//                            the current highest bidder keeps a hold).
let _schemaReady = null;

function ensureBidSchema() {
  if (!_schemaReady) {
    _schemaReady = (async () => {
      await pool.query(
        `ALTER TABLE bid_entries ADD COLUMN IF NOT EXISTS placed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
      );
      const { rows } = await pool.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'bid_entries' AND column_name = 'bid_time'`,
      );
      if (rows.length > 0) {
        await pool.query(
          `UPDATE bid_entries SET placed_at = bid_time
            WHERE bid_time IS NOT NULL AND placed_at IS DISTINCT FROM bid_time`,
        );
      }
      await pool.query(`
        CREATE TABLE IF NOT EXISTS bid_holds (
          bid_id     UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
          user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          amount     DECIMAL(12, 2) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (bid_id, user_id)
        )
      `);
    })().catch((err) => {
      _schemaReady = null; // retry on the next request
      throw err;
    });
  }
  return _schemaReady;
}

// ── Privacy helpers ───────────────────────────────────────────────────────────

/**
 * +251931234562 / 0931234562 / 931234562  →  +25193****2
 * Keeps the country code + operator digits and the last digit only.
 */
function maskPhone(phone) {
  let n = String(phone ?? '').replace(/\D/g, '');
  if (n.length < 7) return '****';
  if (!n.startsWith('251')) {
    if (n.startsWith('0') && n.length === 10) n = `251${n.slice(1)}`;
    else if (n.length === 9) n = `251${n}`;
  }
  return `+${n.slice(0, 5)}****${n.slice(-1)}`;
}

// ── Format Helper ─────────────────────────────────────────────────────────────

/**
 * @param r         raw row
 * @param viewerId  id of the user asking (null for anonymous)
 * @param isStaff   admin / staff panels get the full, unmasked data
 */
function _format(r, viewerId = null, isStaff = false) {
  const startPrice = parseFloat(r.start_price) || 0;
  const minIncrement = parseFloat(r.min_increment) || 0;
  const highestBid = parseFloat(r.highest_bid) || 0;
  const startPriceCents = Math.round(startPrice * 100);
  const minIncrementCents = Math.round(minIncrement * 100);
  const currentBidCents = highestBid > 0 ? Math.round(highestBid * 100) : startPriceCents;
  const productPriceCents = r.product_price_cents ? parseInt(r.product_price_cents, 10) : startPriceCents;

  // The clock is the single source of truth for the phase. The stored status
  // column is only honoured for an explicit CANCELLED (a scheduled auction
  // stays 'DRAFT' in the table forever, so it can't be trusted).
  const nowMs = Date.now();
  const endsMs = new Date(r.ends_at).getTime();
  const startsMs = new Date(r.starts_at).getTime();
  let computedStatus = String(r.status || '').toUpperCase();
  if (computedStatus !== 'CANCELLED') {
    computedStatus = endsMs <= nowMs ? 'ENDED' : startsMs > nowMs ? 'DRAFT' : 'ACTIVE';
  }

  const customerStatus =
    computedStatus === 'ENDED' ? 'closed' : computedStatus === 'ACTIVE' ? 'active' : 'cancelled';

  // Customers only learn the top bidder's id when it is themselves.
  const topId = r.current_bidder_id ?? null;
  const currentBidderId = isStaff || (topId && viewerId && String(topId) === String(viewerId)) ? topId : null;

  const out = {
    id:                      r.id,
    title:                   r.title,
    productId:               r.product_id,
    product_id:              r.product_id,
    productName:             r.product_name ?? '—',
    product_name:            r.product_name ?? '—',
    description:             r.description ?? '',
    productImage:            r.product_image ?? null,
    image_url:               r.product_image ?? null,
    startPrice:              startPrice,
    start_price:             startPrice,
    starting_bid_cents:      startPriceCents,
    minIncrement:            minIncrement,
    min_increment:           minIncrement,
    min_bid_increment_cents: minIncrementCents,
    startsAt:                r.starts_at,
    starts_at:               r.starts_at,
    endsAt:                  r.ends_at,
    ends_at:                 r.ends_at,
    // Server clock so the app's countdown never depends on the phone's clock.
    server_time:             new Date(nowMs).toISOString(),
    serverTime:              new Date(nowMs).toISOString(),
    status:                  computedStatus,
    customer_status:         customerStatus,
    original_price_cents:    productPriceCents,
    product_price_cents:     productPriceCents,
    current_bid_cents:       currentBidCents,
    highest_bid:             highestBid,
    highestBid:              highestBid,
    total_bidders:           r.total_bidders ?? 0,
    totalBidders:            r.total_bidders ?? 0,
    bidder_count:            r.total_bidders ?? 0,
    current_bidder_id:       currentBidderId,
    created_at:              r.created_at,
    createdAt:               r.created_at,
  };

  // Aggregates over everybody's amounts are admin-only.
  if (isStaff) {
    out.lowest_bid = parseFloat(r.lowest_bid) || 0;
    out.lowestBid = out.lowest_bid;
    out.total_collected = parseFloat(r.total_collected) || 0;
    out.totalCollected = out.total_collected;
  }
  return out;
}

// ── Shared SELECT for list / detail ──────────────────────────────────────────

const BID_SELECT = `
  SELECT
    b.*,
    p.name_en          AS product_name,
    p.price_cents      AS product_price_cents,
    p.description_en   AS description,
    pi.image_url       AS product_image,
    COUNT(DISTINCT be.user_id)::int  AS total_bidders,
    COALESCE(MIN(be.amount), 0)::numeric AS lowest_bid,
    COALESCE(MAX(be.amount), 0)::numeric AS highest_bid,
    COALESCE(SUM(be.amount), 0)::numeric AS total_collected,
    (
      SELECT be2.user_id
      FROM bid_entries be2
      WHERE be2.bid_id = b.id
      ORDER BY be2.amount DESC, be2.placed_at ASC
      LIMIT 1
    ) AS current_bidder_id
  FROM bids b
  LEFT JOIN products p  ON p.id = b.product_id
  LEFT JOIN product_images pi ON pi.product_id = b.product_id AND pi.is_primary = true
  LEFT JOIN bid_entries be ON be.bid_id = b.id
`;

const BID_GROUP = `GROUP BY b.id, p.name_en, p.price_cents, p.description_en, pi.image_url`;

async function _attachMyBids(list, userId) {
  if (!userId || list.length === 0) return;
  const bidIds = list.map((b) => b.id);
  const { rows: myEntries } = await pool.query(
    `SELECT bid_id, MAX(amount)::numeric AS max_amount
       FROM bid_entries
      WHERE user_id = $1 AND bid_id = ANY($2::uuid[])
      GROUP BY bid_id`,
    [userId, bidIds],
  );
  const myMap = new Map();
  for (const me of myEntries) {
    myMap.set(me.bid_id, Math.round(parseFloat(me.max_amount) * 100));
  }
  for (const b of list) {
    b.my_bid_cents = myMap.get(b.id) ?? null;
    b.myBidCents = b.my_bid_cents;
  }
}

// ── List all bids ─────────────────────────────────────────────────────────────

async function listBids({ status, page = 1, limit = 20, userId, isStaff = false } = {}) {
  await ensureBidSchema();
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (safePage - 1) * safeLimit;

  const params = [];
  const push = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = ['1=1'];

  if (status) {
    const s = String(status).toUpperCase();
    const now = push(new Date());
    if (s === 'ACTIVE') {
      where.push(`b.status <> 'CANCELLED' AND b.starts_at <= ${now} AND b.ends_at > ${now}`);
    } else if (s === 'ENDED' || s === 'CLOSED') {
      where.push(`b.status <> 'CANCELLED' AND b.ends_at <= ${now}`);
    } else if (s === 'DRAFT' || s === 'UPCOMING') {
      where.push(`b.status <> 'CANCELLED' AND b.starts_at > ${now}`);
    } else {
      params.pop();
      where.push(`b.status = ${push(s)}`);
    }
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM bids b ${whereSql}`,
    params,
  );
  const total = countRes.rows[0]?.total ?? 0;

  const limitIdx = push(safeLimit);
  const offsetIdx = push(offset);
  const { rows } = await pool.query(
    `${BID_SELECT}
     ${whereSql}
     ${BID_GROUP}
     ORDER BY ${isStaff ? 'b.created_at DESC' : 'b.ends_at ASC, b.created_at DESC'}
     LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
    params,
  );

  const formattedBids = rows.map((r) => _format(r, userId, isStaff));
  await _attachMyBids(formattedBids, userId);

  return {
    bids: formattedBids,
    auctions: formattedBids, // support both keys for customer & web
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    server_time: new Date().toISOString(),
  };
}

// ── Get single bid with its bid history ──────────────────────────────────────

async function getBidById(id, userId = null, { isStaff = false } = {}) {
  await ensureBidSchema();
  if (!UUID_RE.test(String(id))) throw new AppError('Bid not found', 404, 'NOT_FOUND');

  const { rows } = await pool.query(
    `${BID_SELECT}
     WHERE b.id = $1
     ${BID_GROUP}`,
    [id],
  );
  if (rows.length === 0) throw new AppError('Bid not found', 404, 'NOT_FOUND');

  const bid = _format(rows[0], userId, isStaff);

  if (isStaff) {
    // ── Admin / staff: full detail, highest first ──────────────────────────
    const { rows: entries } = await pool.query(
      `SELECT
         be.id,
         be.user_id,
         be.amount,
         be.placed_at,
         COALESCE(cu.full_name, u.phone) AS bidder_name,
         u.phone                         AS bidder_phone
       FROM bid_entries be
       LEFT JOIN users u        ON u.id = be.user_id
       LEFT JOIN customer_user cu ON cu.user_id = be.user_id
       WHERE be.bid_id = $1
       ORDER BY be.amount DESC, be.placed_at ASC`,
      [id],
    );

    const highestAmount = entries.length > 0 ? parseFloat(entries[0].amount) : 0;

    bid.entries = entries.map((e) => ({
      id:     e.id,
      user_id: e.user_id,
      userId: e.user_id,
      name:   e.bidder_name ?? 'Unknown',
      bidderName: e.bidder_name ?? 'Unknown',
      bidder_name: e.bidder_name ?? 'Unknown',
      phone:  e.bidder_phone,
      amount: parseFloat(e.amount),
      amountCents: Math.round(parseFloat(e.amount) * 100),
      bid_amount_cents: Math.round(parseFloat(e.amount) * 100),
      at:     e.placed_at,
      bid_time: e.placed_at,
      is_highest: parseFloat(e.amount) === highestAmount,
      isHighest: parseFloat(e.amount) === highestAmount,
    }));
  } else {
    // ── Customers: one row per bid entry (a user who bids twice shows twice),
    // masked phone, no amounts of others, newest first ──
    const { rows: entries } = await pool.query(
      `SELECT be.id, be.user_id, be.amount, be.placed_at, u.phone AS bidder_phone
       FROM bid_entries be
       LEFT JOIN users u ON u.id = be.user_id
       WHERE be.bid_id = $1
       ORDER BY be.placed_at DESC`,
      [id],
    );

    bid.entries = entries.map((e) => {
      const mine = !!userId && !!e.user_id && String(e.user_id) === String(userId);
      const masked = maskPhone(e.bidder_phone);
      const row = {
        id:          e.id,
        masked_phone: masked,
        name:        masked,
        bidderName:  masked,
        bidder_name: masked,
        phone:       masked,
        is_mine:     mine,
        isMine:      mine,
        at:          e.placed_at,
        bid_time:    e.placed_at,
      };
      // A customer may see their own amount, never anybody else's.
      if (mine) {
        const cents = Math.round(parseFloat(e.amount) * 100);
        row.amount = parseFloat(e.amount);
        row.amountCents = cents;
        row.bid_amount_cents = cents;
      }
      return row;
    });
  }

  // Alias entries as bids for customer app
  bid.bids = bid.entries;

  if (userId) {
    const { rows: mine } = await pool.query(
      `SELECT MAX(amount)::numeric AS max_amount FROM bid_entries WHERE bid_id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (mine[0]?.max_amount != null) {
      bid.my_bid_cents = Math.round(parseFloat(mine[0].max_amount) * 100);
      bid.myBidCents = bid.my_bid_cents;
    }
  }

  return bid;
}

// ── Create bid (Admin) ────────────────────────────────────────────────────────

function _statusFor(start, end) {
  const now = Date.now();
  return start.getTime() <= now && end.getTime() > now ? 'ACTIVE' : start.getTime() > now ? 'DRAFT' : 'ENDED';
}

function _parseDate(value, label) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AppError(`${label} is not a valid date`, 400, 'INVALID_DATE');
  return d;
}

async function createBid({ title, productId, startPrice, minIncrement, startsAt, endsAt }) {
  await ensureBidSchema();
  // Passing JS Dates (not strings) keeps the TIMESTAMP columns consistent with
  // how node-pg reads them back, whatever timezone the server runs in.
  const start = _parseDate(startsAt, 'Start time');
  const end = _parseDate(endsAt, 'End time');
  if (end <= start) throw new AppError('End time must be after the start time', 400, 'INVALID_DATE');

  const { rows } = await pool.query(
    `INSERT INTO bids (title, product_id, start_price, min_increment, starts_at, ends_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [title, productId, startPrice, minIncrement, start, end, _statusFor(start, end)],
  );
  return getBidById(rows[0].id, null, { isStaff: true });
}

// ── Update bid (Admin) ────────────────────────────────────────────────────────

async function updateBid(id, { title, productId, startPrice, minIncrement, startsAt, endsAt } = {}) {
  await ensureBidSchema();
  if (!UUID_RE.test(String(id))) throw new AppError('Bid not found', 404, 'NOT_FOUND');

  const { rows: cur } = await pool.query('SELECT starts_at, ends_at, status FROM bids WHERE id = $1', [id]);
  if (cur.length === 0) throw new AppError('Bid not found', 404, 'NOT_FOUND');

  // Merge with what is stored so a partial update can't flip the status.
  const start = startsAt ? _parseDate(startsAt, 'Start time') : new Date(cur[0].starts_at);
  const end = endsAt ? _parseDate(endsAt, 'End time') : new Date(cur[0].ends_at);
  if (end <= start) throw new AppError('End time must be after the start time', 400, 'INVALID_DATE');
  const status = String(cur[0].status).toUpperCase() === 'CANCELLED' ? 'CANCELLED' : _statusFor(start, end);

  await pool.query(
    `UPDATE bids
     SET title = COALESCE($1, title),
         product_id = COALESCE($2, product_id),
         start_price = COALESCE($3, start_price),
         min_increment = COALESCE($4, min_increment),
         starts_at = $5,
         ends_at = $6,
         status = $7,
         updated_at = NOW()
     WHERE id = $8`,
    [title ?? null, productId ?? null, startPrice ?? null, minIncrement ?? null, start, end, status, id],
  );
  return getBidById(id, null, { isStaff: true });
}

// ── Wallet helpers (always called inside a transaction) ──────────────────────

async function _walletTx(client, userId, { title, description, amount, type, metadata }) {
  await client.query(
    `INSERT INTO wallet_transactions (user_id, title, description, amount, type, status, metadata)
     VALUES ($1, $2, $3, $4, $5, 'COMPLETED', $6)`,
    [userId, String(title).slice(0, 255), description ?? null, amount, type, JSON.stringify(metadata ?? {})],
  );
}

/** Give a user's held money back to their wallet. Returns the refunded amount. */
async function _releaseHold(client, bidId, userId, { title, description }) {
  const { rows } = await client.query(
    `DELETE FROM bid_holds WHERE bid_id = $1 AND user_id = $2 RETURNING amount`,
    [bidId, userId],
  );
  if (rows.length === 0) return 0;
  const held = parseFloat(rows[0].amount) || 0;
  if (held <= 0) return 0;

  await client.query(
    `UPDATE users SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [held, userId],
  );
  await _walletTx(client, userId, {
    title,
    description,
    amount: held,
    type: 'REFUND',
    metadata: { bidId, amountETB: held, reason: 'BID_RELEASE' },
  });
  return held;
}

// ── Delete bid (Admin) ────────────────────────────────────────────────────────

async function deleteBid(id) {
  await ensureBidSchema();
  if (!UUID_RE.test(String(id))) throw new AppError('Bid not found', 404, 'NOT_FOUND');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: bidRows } = await client.query(
      'SELECT id, title FROM bids WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (bidRows.length === 0) throw new AppError('Bid not found', 404, 'NOT_FOUND');

    // Anything still held for this auction goes back to the bidders first.
    const { rows: holds } = await client.query(
      'SELECT user_id FROM bid_holds WHERE bid_id = $1 ORDER BY user_id',
      [id],
    );
    if (holds.length > 0) {
      await client.query(
        `SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [holds.map((h) => h.user_id)],
      );
      for (const h of holds) {
        await _releaseHold(client, id, h.user_id, {
          title: `Bid refunded - ${bidRows[0].title}`,
          description: 'The auction was removed.',
        });
      }
    }

    await client.query('DELETE FROM bids WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Place bid entry (Customer action) ────────────────────────────────────────
//
// Every bid entry is charged IN FULL from the bidder's wallet — a user who
// bids 14 then 2 loses 16 (500 → 484). Any positive amount is accepted:
// bids may be below, equal to, or above the current top bid. The auction row
// is locked so entries are serialized.

async function placeBidEntry(bidId, userId, amountInput) {
  await ensureBidSchema();
  if (!UUID_RE.test(String(bidId))) throw new AppError('Auction not found', 404, 'NOT_FOUND');

  // The controller already converts cents → ETB, so the value is in Birr here.
  const amount = round2(Number(amountInput));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('Enter a valid bid amount', 400, 'INVALID_AMOUNT');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the auction: bids on the same auction are processed one at a time.
    const { rows: bidRows } = await client.query(
      `SELECT id, title, status, starts_at, ends_at
         FROM bids WHERE id = $1 FOR UPDATE`,
      [bidId],
    );
    if (bidRows.length === 0) throw new AppError('Auction not found', 404, 'NOT_FOUND');
    const bid = bidRows[0];

    const nowMs = Date.now();
    if (String(bid.status).toUpperCase() === 'CANCELLED') {
      throw new AppError('Auction is not active', 400, 'BID_NOT_ACTIVE');
    }
    if (new Date(bid.starts_at).getTime() > nowMs) {
      throw new AppError('This auction has not started yet', 400, 'BID_NOT_STARTED');
    }
    if (new Date(bid.ends_at).getTime() <= nowMs) {
      throw new AppError('Auction has ended', 410, 'BID_ENDED');
    }

    // Lock the bidder's wallet row, then debit the full bid amount.
    const { rows: lockedUsers } = await client.query(
      `SELECT id, balance FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const me = lockedUsers[0];
    if (!me) throw new AppError('Account not found', 404, 'USER_NOT_FOUND');

    const balance = parseFloat(me.balance) || 0;
    if (balance < amount) {
      throw new AppError(
        `Insufficient wallet balance. This bid needs ETB ${amount.toFixed(2)} but your wallet has ETB ${balance.toFixed(2)}. Please top up your wallet.`,
        400,
        'INSUFFICIENT_BALANCE',
      );
    }

    const { rows: debited } = await client.query(
      `UPDATE users
          SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND balance >= $1
        RETURNING balance`,
      [amount, userId],
    );
    if (debited.length === 0) {
      throw new AppError('Insufficient wallet balance', 400, 'INSUFFICIENT_BALANCE');
    }

    await _walletTx(client, userId, {
      title: `Bid placed - ${bid.title}`,
      description: 'Deducted from your wallet for your bid.',
      amount: -amount,
      type: 'BID_HOLD',
      metadata: { bidId, amountETB: amount },
    });

    const { rows: entry } = await client.query(
      `INSERT INTO bid_entries (bid_id, user_id, amount, placed_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, bid_id, user_id, amount, placed_at`,
      [bidId, userId, amount, new Date(nowMs)],
    );

    await client.query('COMMIT');

    return {
      ...entry[0],
      charged: amount,
      wallet_balance: parseFloat(debited[0].balance) || 0,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Customer: Get My Bids ────────────────────────────────────────────────────

async function getMyBids(userId) {
  await ensureBidSchema();
  const { rows } = await pool.query(
    `SELECT DISTINCT
       b.*,
       p.name_en          AS product_name,
       p.price_cents      AS product_price_cents,
       p.description_en   AS description,
       pi.image_url       AS product_image,
       COUNT(DISTINCT be.user_id)::int  AS total_bidders,
       COALESCE(MAX(be.amount), 0)::numeric AS highest_bid,
       (
         SELECT be2.user_id
         FROM bid_entries be2
         WHERE be2.bid_id = b.id
         ORDER BY be2.amount DESC, be2.placed_at ASC
         LIMIT 1
       ) AS current_bidder_id
     FROM bids b
     JOIN bid_entries my_be ON my_be.bid_id = b.id AND my_be.user_id = $1
     LEFT JOIN products p  ON p.id = b.product_id
     LEFT JOIN product_images pi ON pi.product_id = b.product_id AND pi.is_primary = true
     LEFT JOIN bid_entries be ON be.bid_id = b.id
     GROUP BY b.id, p.name_en, p.price_cents, p.description_en, pi.image_url
     ORDER BY b.ends_at DESC`,
    [userId],
  );

  const formatted = rows.map((r) => _format(r, userId, false));
  await _attachMyBids(formatted, userId);
  return formatted;
}

// ── Customer: Get Won Auctions ───────────────────────────────────────────────

async function getWonAuctions(userId) {
  const myBids = await getMyBids(userId);
  return myBids.filter(
    (b) =>
      new Date(b.endsAt) <= new Date() &&
      b.current_bidder_id != null &&
      String(b.current_bidder_id) === String(userId),
  );
}

module.exports = {
  listBids,
  getBidById,
  createBid,
  updateBid,
  deleteBid,
  placeBidEntry,
  getMyBids,
  getWonAuctions,
  maskPhone,
};
