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

async function getAll(req, res, next) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const userId = req.user?.id;
    const result = await listBids({ status, page: parseInt(page, 10), limit: parseInt(limit, 10), userId });
    ok(res, result);
  } catch (e) {
    next(e);
  }
}

async function getOne(req, res, next) {
  try {
    const userId = req.user?.id;
    const bid = await getBidById(req.params.id, userId);
    ok(res, { bid, auction: bid, data: bid });
  } catch (e) {
    next(e);
  }
}

async function create(req, res, next) {
  try {
    const title = req.body.title;
    const productId = req.body.productId || req.body.product_id;
    const startPrice = req.body.startPrice != null
      ? Number(req.body.startPrice)
      : (req.body.startPriceCents != null
        ? Number(req.body.startPriceCents) / 100
        : (req.body.start_price_cents != null ? Number(req.body.start_price_cents) / 100 : null));
    const minIncrement = req.body.minIncrement != null
      ? Number(req.body.minIncrement)
      : (req.body.minBidIncrementCents != null
        ? Number(req.body.minBidIncrementCents) / 100
        : (req.body.min_bid_increment_cents != null ? Number(req.body.min_bid_increment_cents) / 100 : 10));
    const startsAt = req.body.startsAt || req.body.starts_at;
    const endsAt = req.body.endsAt || req.body.ends_at;

    if (!title || !productId || startPrice == null || !startsAt || !endsAt) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    const bid = await createBid({ title, productId, startPrice, minIncrement, startsAt, endsAt });
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
        : (req.body.amount != null ? Number(req.body.amount) : null));
    if (amount == null || isNaN(amount)) {
      return res.status(400).json({ success: false, message: 'Bid amount is required' });
    }
    const entry = await placeBidEntry(req.params.id, userId, amount);
    ok(res, { entry, message: 'Bid placed successfully' });
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
