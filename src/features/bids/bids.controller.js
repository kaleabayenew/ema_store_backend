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
    const { title, productId, startPrice, minIncrement, startsAt, endsAt } = req.body;
    if (!title || !productId || !startPrice || !minIncrement || !startsAt || !endsAt) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    const bid = await createBid({ title, productId, startPrice, minIncrement, startsAt, endsAt });
    created(res, { bid });
  } catch (e) {
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const bid = await updateBid(req.params.id, req.body);
    ok(res, { bid });
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
    const amount = req.body.bid_amount_cents != null ? req.body.bid_amount_cents : req.body.amount;
    if (amount == null) {
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
