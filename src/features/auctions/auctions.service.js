// src/features/auctions/auctions.service.js

const { pool } = require('../../core/config/database');

class AuctionsService {
  // Get all active auctions
  async getActiveAuctions() {
    const query = `
      SELECT
        a.id,
        a.title,
        a.description,
        a.start_price_cents,
        a.current_bid_cents,
        a.starts_at,
        a.ends_at,
        a.min_bid_increment_cents,
        a.status,
        a.product_id,
        p.name as product_name,
        p.image_url as product_image,
        p.price_cents as product_price,
        COUNT(b.id) as bidder_count
      FROM auctions a
      LEFT JOIN products p ON a.product_id = p.id
      LEFT JOIN auction_bids b ON a.id = b.auction_id
      WHERE a.status = 'ACTIVE'
        AND a.starts_at <= NOW()
        AND a.ends_at > NOW()
      GROUP BY a.id, a.title, a.description, a.start_price_cents, a.current_bid_cents, a.starts_at, a.ends_at, a.min_bid_increment_cents, a.status, a.product_id, p.name, p.image_url, p.price_cents
      ORDER BY a.ends_at ASC
    `;

    const result = await pool.query(query);

    return {
      success: true,
      auctions: result.rows.map(row => ({
        id: row.id,
        title: row.title,
        description: row.description,
        startPriceCents: parseInt(row.start_price_cents),
        currentBidCents: parseInt(row.current_bid_cents),
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        minBidIncrementCents: parseInt(row.min_bid_increment_cents),
        status: row.status,
        productId: row.product_id,
        productName: row.product_name,
        productImage: row.product_image,
        productPriceCents: parseInt(row.price_cents),
        bidderCount: parseInt(row.bidder_count)
      }))
    };
  }

  // Get auction by ID with bid history
  async getAuctionById(auctionId) {
    const query = `
      SELECT
        a.id,
        a.title,
        a.description,
        a.start_price_cents,
        a.current_bid_cents,
        a.current_bidder_id,
        a.starts_at,
        a.ends_at,
        a.min_bid_increment_cents,
        a.status,
        a.product_id,
        p.name as product_name,
        p.image_url as product_image,
        p.price_cents as product_price
      FROM auctions a
      LEFT JOIN products p ON a.product_id = p.id
      WHERE a.id = $1
    `;

    const result = await pool.query(query, [auctionId]);

    if (result.rows.length === 0) {
      throw new Error('Auction not found');
    }

    const auction = result.rows[0];

    // Get bid history
    const bidsQuery = `
      SELECT
        b.id,
        b.auction_id,
        b.user_id,
        u.full_name as bidder_name,
        b.bid_amount_cents,
        b.bid_time
      FROM auction_bids b
      LEFT JOIN users u ON b.user_id = u.id
      WHERE b.auction_id = $1
      ORDER BY b.bid_amount_cents DESC, b.bid_time ASC
    `;

    const bidsResult = await pool.query(bidsQuery, [auctionId]);

    return {
      success: true,
      auction: {
        id: auction.id,
        title: auction.title,
        description: auction.description,
        startPriceCents: parseInt(auction.start_price_cents),
        currentBidCents: parseInt(auction.current_bid_cents),
        currentBidderId: auction.current_bidder_id,
        startsAt: auction.starts_at,
        endsAt: auction.ends_at,
        minBidIncrementCents: parseInt(auction.min_bid_increment_cents),
        status: auction.status,
        productId: auction.product_id,
        productName: auction.product_name,
        productImage: auction.product_image,
        productPriceCents: parseInt(auction.price_cents),
        bids: bidsResult.rows.map(row => ({
          id: row.id,
          auctionId: row.auction_id,
          userId: row.user_id,
          bidderName: row.bidder_name,
          bidAmountCents: parseInt(row.bid_amount_cents),
          bidTime: row.bid_time
        }))
      }
    };
  }

  // Place a bid on an auction
  async placeBid(auctionId, userId, bidAmountCents) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get auction details
      const auctionQuery = `
        SELECT
          start_price_cents,
          current_bid_cents,
          min_bid_increment_cents,
          current_bidder_id,
          ends_at,
          status
        FROM auctions
        WHERE id = $1
        FOR UPDATE
      `;

      const auctionResult = await client.query(auctionQuery, [auctionId]);

      if (auctionResult.rows.length === 0) {
        throw new Error('Auction not found');
      }

      const auction = auctionResult.rows[0];

      // Validate auction is active
      if (auction.status !== 'ACTIVE') {
        throw new Error('Auction is not active');
      }

      // Validate auction hasn't ended
      if (new Date(auction.ends_at) < new Date()) {
        throw new Error('Auction has ended');
      }

      // Validate bid amount
      const minBid = Math.max(
        parseInt(auction.current_bid_cents),
        parseInt(auction.start_price_cents)
      ) + parseInt(auction.min_bid_increment_cents);

      if (bidAmountCents < minBid) {
        throw new Error(`Minimum bid is ${(minBid / 100).toFixed(2)} Birr`);
      }

      // Prevent user from bidding on their own auction
      // (This would need seller info, skipping for now)

      // Place the bid
      const bidQuery = `
        INSERT INTO auction_bids
        (auction_id, user_id, bid_amount_cents, bid_time)
        VALUES ($1, $2, $3, NOW())
        RETURNING *
      `;

      const bidResult = await client.query(bidQuery, [
        auctionId,
        userId,
        bidAmountCents
      ]);

      // Update auction's current bid
      const updateQuery = `
        UPDATE auctions
        SET current_bid_cents = $1,
            current_bidder_id = $2
        WHERE id = $3
      `;

      await client.query(updateQuery, [bidAmountCents, userId, auctionId]);

      await client.query('COMMIT');

      return {
        success: true,
        message: 'Bid placed successfully',
        bid: {
          id: bidResult.rows[0].id,
          auctionId: auctionId,
          userId: userId,
          bidAmountCents: bidAmountCents,
          bidTime: bidResult.rows[0].bid_time
        }
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get user's bidding history
  async getUserBids(userId) {
    const query = `
      SELECT
        b.id,
        b.auction_id,
        b.bid_amount_cents,
        b.bid_time,
        a.title as auction_title,
        a.status as auction_status,
        a.ends_at as auction_ends_at,
        a.current_bid_cents,
        a.current_bidder_id
      FROM auction_bids b
      JOIN auctions a ON b.auction_id = a.id
      WHERE b.user_id = $1
      ORDER BY b.bid_time DESC
    `;

    const result = await pool.query(query, [userId]);

    return {
      success: true,
      bids: result.rows.map(row => ({
        id: row.id,
        auctionId: row.auction_id,
        bidAmountCents: parseInt(row.bid_amount_cents),
        bidTime: row.bid_time,
        auctionTitle: row.auction_title,
        auctionStatus: row.auction_status,
        auctionEndsAt: row.auction_ends_at,
        currentBidCents: parseInt(row.current_bid_cents),
        currentBidderId: row.current_bidder_id,
        isHighestBidder: row.current_bidder_id === userId
      }))
    };
  }

  // Get auctions user has won
  async getUserWonAuctions(userId) {
    const query = `
      SELECT
        a.id,
        a.title,
        a.description,
        a.current_bid_cents,
        a.ends_at,
        a.status,
        a.product_id,
        p.name as product_name,
        p.image_url as product_image
      FROM auctions a
      LEFT JOIN products p ON a.product_id = p.id
      WHERE a.status = 'CLOSED'
        AND a.current_bidder_id = $1
      ORDER BY a.ends_at DESC
    `;

    const result = await pool.query(query, [userId]);

    return {
      success: true,
      auctions: result.rows.map(row => ({
        id: row.id,
        title: row.title,
        description: row.description,
        currentBidCents: parseInt(row.current_bid_cents),
        endsAt: row.ends_at,
        status: row.status,
        productId: row.product_id,
        productName: row.product_name,
        productImage: row.product_image
      }))
    };
  }

  // Create auction (admin only)
  async createAuction(data) {
    const {
      title,
      description,
      productId,
      startPriceCents,
      minBidIncrementCents,
      startsAt,
      endsAt
    } = data;

    const query = `
      INSERT INTO auctions
      (title, description, product_id, start_price_cents, current_bid_cents, min_bid_increment_cents, starts_at, ends_at, status)
      VALUES ($1, $2, $3, $4, $4, $5, $6, $7, 'ACTIVE')
      RETURNING *
    `;

    const result = await pool.query(query, [
      title,
      description,
      productId,
      startPriceCents,
      startPriceCents,
      minBidIncrementCents,
      startsAt,
      endsAt
    ]);

    return {
      success: true,
      auction: {
        id: result.rows[0].id,
        title: result.rows[0].title,
        description: result.rows[0].description,
        productId: result.rows[0].product_id,
        startPriceCents: parseInt(result.rows[0].start_price_cents),
        currentBidCents: parseInt(result.rows[0].current_bid_cents),
        minBidIncrementCents: parseInt(result.rows[0].min_bid_increment_cents),
        startsAt: result.rows[0].starts_at,
        endsAt: result.rows[0].ends_at,
        status: result.rows[0].status
      }
    };
  }
}

module.exports = new AuctionsService();
