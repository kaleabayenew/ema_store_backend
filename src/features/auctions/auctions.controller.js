// src/features/auctions/auctions.controller.js

const auctionsService = require('./auctions.service');

// Get all active auctions
async function getActiveAuctions(req, res) {
  try {
    const result = await auctionsService.getActiveAuctions();
    res.json(result);
  } catch (error) {
    console.error('Error fetching auctions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch auctions',
      error: error.message
    });
  }
}

// Get auction by ID
async function getAuctionById(req, res) {
  try {
    const { id } = req.params;
    const result = await auctionsService.getAuctionById(id);
    res.json(result);
  } catch (error) {
    console.error('Error fetching auction:', error);
    res.status(404).json({
      success: false,
      message: error.message || 'Auction not found'
    });
  }
}

// Place a bid
async function placeBid(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const { bidAmountCents } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!bidAmountCents || bidAmountCents <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bid amount'
      });
    }

    const result = await auctionsService.placeBid(id, userId, bidAmountCents);
    res.json(result);
  } catch (error) {
    console.error('Error placing bid:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to place bid'
    });
  }
}

// Get user's bidding history
async function getUserBids(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const result = await auctionsService.getUserBids(userId);
    res.json(result);
  } catch (error) {
    console.error('Error fetching user bids:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bidding history',
      error: error.message
    });
  }
}

// Get user's won auctions
async function getUserWonAuctions(req, res) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const result = await auctionsService.getUserWonAuctions(userId);
    res.json(result);
  } catch (error) {
    console.error('Error fetching won auctions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch won auctions',
      error: error.message
    });
  }
}

// Create auction (admin only)
async function createAuction(req, res) {
  try {
    const { title, description, productId, startPriceCents, minBidIncrementCents, startsAt, endsAt } = req.body;

    if (!title || !productId || !startPriceCents || !startsAt || !endsAt) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const result = await auctionsService.createAuction({
      title,
      description,
      productId,
      startPriceCents,
      minBidIncrementCents: minBidIncrementCents || 1000, // Default 10 Birr
      startsAt,
      endsAt
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating auction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create auction',
      error: error.message
    });
  }
}

module.exports = {
  getActiveAuctions,
  getAuctionById,
  placeBid,
  getUserBids,
  getUserWonAuctions,
  createAuction
};
