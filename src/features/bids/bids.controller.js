const {
  listBids,
  getBidById,
  createBid,
  updateBid,
  deleteBid,
  placeBidEntry,
  getMyBids,
  getWonAuctions,
} = require('./bids.service');
const { ok, created } = require('../../core/utils/response');
const { AppError } = require('../../core/errors/app_error');

// Staff / admin panels see the full bid data. Everybody else (customers,
// anonymous visitors, partners, riders) gets masked phones and no amounts of
// other bidders. The role comes from the verified token (see bids.router).
const STAFF_ROLES = [
  'ADMIN', 'SUPER_ADMIN', 'CUSTOMER_SUPPORT', 'MANAGER', 'MANAGEMENT',
  'PARTNER_MANAGER', 'PRODUCT_MANAGER', 'FINANCE', 'MARKETING',
];
const isStaffReq = (req) => STAFF_ROLES.includes(String(req.user?.role || '').toUpperCase());

async function getAll(req, res, next) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const userId = req.user?.id;
    const result = await listBids({
      status,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      userId,
      isStaff: isStaffReq(req),
    });
    ok(res, result);
  } catch (e) {
    next(e);
  }
}

async function getOne(req, res, next) {
  try {
    const userId = req.user?.id;
    const bid = await getBidById(req.params.id, userId, { isStaff: isStaffReq(req) });
    ok(res, { bid, auction: bid, data: bid });
  } catch (e) {
    next(e);
  }
}

async function create(req, res, next) {
  try {
    const title = req.body.title;
    const productId = req.body.productId || req.body.product_id;
    const startsAt = req.body.startsAt || req.body.starts_at;
    const endsAt = req.body.endsAt || req.body.ends_at;

    if (!title || !productId || !startsAt || !endsAt) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    const bid = await createBid({ title, productId, startsAt, endsAt });
    created(res, { bid, auction: bid });
  } catch (e) {
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const bid = await updateBid(req.params.id, req.body);
    ok(res, { bid, auction: bid });
  } catch (e) {
    next(e);
  }
}

async function remove(req, res, next) {
  try {
    await deleteBid(req.params.id);
    ok(res, { message: 'Bid deleted' });
  } catch (e) {
    next(e);
  }
}

async function placeEntry(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    const amount = req.body.bid_amount_cents != null
      ? Number(req.body.bid_amount_cents) / 100
      : (req.body.bidAmountCents != null
        ? Number(req.body.bidAmountCents) / 100
        : (req.body.amountCents != null
          ? Number(req.body.amountCents) / 100
          : (req.body.amount != null ? Number(req.body.amount) : null)));
    if (amount == null || isNaN(amount)) {
      return res.status(400).json({ success: false, message: 'Bid amount is required' });
    }
    const entry = await placeBidEntry(
      req.params.id,
      userId,
      amount,
      req.get('Idempotency-Key') || req.body.idempotency_key || null,
    );
    ok(res, {
      entry,
      wallet_balance: entry.wallet_balance,
      charged: entry.charged,
      message: 'Bid placed successfully',
    });
  } catch (e) {
    next(e);
  }
}

async function fetchMyBids(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    const bids = await getMyBids(userId);
    ok(res, { bids, auctions: bids, data: bids });
  } catch (e) {
    next(e);
  }
}

async function fetchWon(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    const won = await getWonAuctions(userId);
    ok(res, { bids: won, auctions: won, data: won });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  getAll,
  getOne,
  create,
  update,
  remove,
  placeEntry,
  fetchMyBids,
  fetchWon,
};