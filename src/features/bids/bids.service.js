const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// ── Format Helper ─────────────────────────────────────────────────────────────

function _format(r) {
  const startPrice = parseFloat(r.start_price) || 0;
  const minIncrement = parseFloat(r.min_increment) || 0;
  const highestBid = parseFloat(r.highest_bid) || 0;
  const startPriceCents = Math.round(startPrice * 100);
  const minIncrementCents = Math.round(minIncrement * 100);
  const currentBidCents = highestBid > 0 ? Math.round(highestBid * 100) : startPriceCents;
  const productPriceCents = r.product_price_cents ? parseInt(r.product_price_cents, 10) : startPriceCents;

  const now = new Date();
  const endsAtDate = new Date(r.ends_at);
  const startsAtDate = new Date(r.starts_at);
  let computedStatus = r.status || 'ACTIVE';
  if (endsAtDate <= now) computedStatus = 'ENDED';
  else if (startsAtDate > now) computedStatus = 'DRAFT';

  const customerStatus = computedStatus === 'ENDED' ? 'closed' : computedStatus === 'DRAFT' ? 'cancelled' : 'active';

  return {
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
    status:                  computedStatus,
    customer_status:         customerStatus,
    original_price_cents:    productPriceCents,
    product_price_cents:     productPriceCents,
    current_bid_cents:       currentBidCents,
    highest_bid:             highestBid,
    highestBid:              highestBid,
    lowest_bid:              parseFloat(r.lowest_bid) || 0,
    lowestBid:               parseFloat(r.lowest_bid) || 0,
    total_bidders:           r.total_bidders ?? 0,
    totalBidders:            r.total_bidders ?? 0,
    bidder_count:            r.total_bidders ?? 0,
    total_collected:         parseFloat(r.total_collected) || 0,
    totalCollected:          parseFloat(r.total_collected) || 0,
    current_bidder_id:       r.current_bidder_id ?? null,
    created_at:              r.created_at,
    createdAt:               r.created_at,
  };
}

// ── List all bids ─────────────────────────────────────────────────────────────

async function listBids({ status, page = 1, limit = 20, userId } = {}) {
  const offset = (page - 1) * limit;
  let where = 'WHERE 1=1';
  const params = [];
  let idx = 1;

  if (status) {
    if (status.toUpperCase() === 'ACTIVE') {
      where += ` AND b.status = 'ACTIVE' AND b.ends_at > NOW() AND b.starts_at <= NOW()`;
    } else if (status.toUpperCase() === 'ENDED' || status === 'closed') {
      where += ` AND (b.status = 'ENDED' OR b.ends_at <= NOW())`;
    } else {
      where += ` AND b.status = $${idx}`;
      params.push(status);
      idx++;
    }
  }

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM bids b ${where}`,
    params,
  );
  const total = countRes.rows[0]?.total ?? 0;

  const { rows } = await pool.query(
    `SELECT
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
     ${where}
     GROUP BY b.id, p.name_en, p.price_cents, p.description_en, pi.image_url
     ORDER BY b.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset],
  );

  const formattedBids = rows.map(_format);

  // If userId is provided, attach my_bid_cents for each auction
  if (userId && formattedBids.length > 0) {
    const bidIds = formattedBids.map((b) => b.id);
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
    for (const b of formattedBids) {
      b.my_bid_cents = myMap.get(b.id) ?? null;
      b.myBidCents = b.my_bid_cents;
    }
  }

  return {
    bids: formattedBids,
    auctions: formattedBids, // support both keys for customer & web
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

// ── Get single bid with all entries ──────────────────────────────────────────

async function getBidById(id, userId = null) {
  const { rows } = await pool.query(
    `SELECT
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
     WHERE b.id = $1
     GROUP BY b.id, p.name_en, p.price_cents, p.description_en, pi.image_url`,
    [id],
  );
  if (rows.length === 0) throw new AppError('Bid not found', 404, 'NOT_FOUND');

  const bid = _format(rows[0]);

  // Fetch all entries sorted highest → lowest
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

  // Alias entries as bids for customer app
  bid.bids = bid.entries;

  if (userId) {
    const myEntry = entries.find((e) => e.user_id === userId);
    if (myEntry) {
      bid.my_bid_cents = Math.round(parseFloat(myEntry.amount) * 100);
      bid.myBidCents = bid.my_bid_cents;
    }
  }

  return bid;
}

// ── Create bid (Admin) ────────────────────────────────────────────────────────

async function createBid({ title, productId, startPrice, minIncrement, startsAt, endsAt }) {
  const now = new Date();
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const status = start <= now && end > now ? 'ACTIVE' : start > now ? 'DRAFT' : 'ENDED';

  const { rows } = await pool.query(
    `INSERT INTO bids (title, product_id, start_price, min_increment, starts_at, ends_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [title, productId, startPrice, minIncrement, startsAt, endsAt, status],
  );
  return getBidById(rows[0].id);
}

// ── Update bid (Admin) ────────────────────────────────────────────────────────

async function updateBid(id, { title, productId, startPrice, minIncrement, startsAt, endsAt }) {
  const now = new Date();
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const status = start <= now && end > now ? 'ACTIVE' : start > now ? 'DRAFT' : 'ENDED';

  const { rowCount } = await pool.query(
    `UPDATE bids
     SET title = COALESCE($1, title),
         product_id = COALESCE($2, product_id),
         start_price = COALESCE($3, start_price),
         min_increment = COALESCE($4, min_increment),
         starts_at = COALESCE($5, starts_at),
         ends_at = COALESCE($6, ends_at),
         status = $7,
         updated_at = NOW()
     WHERE id = $8`,
    [title, productId, startPrice, minIncrement, startsAt, endsAt, status, id],
  );
  if (rowCount === 0) throw new AppError('Bid not found', 404, 'NOT_FOUND');
  return getBidById(id);
}

// ── Delete bid (Admin) ────────────────────────────────────────────────────────

async function deleteBid(id) {
  const { rowCount } = await pool.query('DELETE FROM bids WHERE id = $1', [id]);
  if (rowCount === 0) throw new AppError('Bid not found', 404, 'NOT_FOUND');
}

// ── Place bid entry (Customer action) ────────────────────────────────────────

async function placeBidEntry(bidId, userId, amountInput) {
  const { rows: bidRows } = await pool.query(
    `SELECT start_price, min_increment, status, ends_at FROM bids WHERE id = $1`,
    [bidId],
  );
  if (bidRows.length === 0) throw new AppError('Auction not found', 404, 'NOT_FOUND');
  const bid = bidRows[0];

  if (bid.status !== 'ACTIVE') throw new AppError('Auction is not active', 400, 'BID_NOT_ACTIVE');
  if (new Date(bid.ends_at) < new Date()) throw new AppError('Auction has ended', 410, 'BID_ENDED');

  const { rows: maxRows } = await pool.query(
    `SELECT COALESCE(MAX(amount), 0)::numeric AS current_max FROM bid_entries WHERE bid_id = $1`,
    [bidId],
  );
  const currentMax = parseFloat(maxRows[0].current_max);
  const startPrice = parseFloat(bid.start_price);
  const minIncrement = parseFloat(bid.min_increment);

  // Amount may arrive in ETB or in cents (e.g., if > 10000 or customer sent cents)
  let amount = Number(amountInput);
  // If amount is passed as cents (like bid_amount_cents), convert to Birr
  if (amount > 1000 && amount % 100 === 0 && amount >= (startPrice * 100)) {
    amount = amount / 100;
  }

  const minRequired = currentMax > 0 ? currentMax + minIncrement : startPrice;

  if (amount < minRequired) {
    throw new AppError(`Minimum bid is ETB ${minRequired.toLocaleString()}`, 409, 'BID_TOO_LOW');
  }

  const { rows } = await pool.query(
    `INSERT INTO bid_entries (bid_id, user_id, amount) VALUES ($1, $2, $3) RETURNING *`,
    [bidId, userId, amount],
  );

  return rows[0];
}

// ── Customer: Get My Bids ────────────────────────────────────────────────────

async function getMyBids(userId) {
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

  const formatted = rows.map(_format);

  if (formatted.length > 0) {
    const bidIds = formatted.map((b) => b.id);
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
    for (const b of formatted) {
      b.my_bid_cents = myMap.get(b.id) ?? null;
      b.myBidCents = b.my_bid_cents;
    }
  }

  return formatted;
}

// ── Customer: Get Won Auctions ───────────────────────────────────────────────

async function getWonAuctions(userId) {
  const myBids = await getMyBids(userId);
  return myBids.filter((b) => {
    return (b.status === 'ENDED' || new Date(b.endsAt) <= new Date()) && b.current_bidder_id === userId;
  });
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
};
