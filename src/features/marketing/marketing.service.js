const { pool } = require('../../core/config/database');
const { AppError } = require('../../core/errors/app_error');

// ── Get wheel configuration for customer ───────────────────────────────────────

async function getWheelConfig(userId) {
  // Get active slices
  const { rows: slices } = await pool.query(
    `SELECT id, slice_index, label, reward_type, reward_value, probability_weight, color_hex
     FROM wheel_slices
     WHERE is_active = true
     ORDER BY slice_index ASC`
  );

  // Get user's remaining spins for today
  const { rows: spinData } = await pool.query(
    `SELECT spins_today, last_spin_date
     FROM user_spins
     WHERE user_id = $1 AND last_spin_date = CURRENT_DATE`,
    [userId]
  );

  const spinsToday = spinData[0]?.spins_today || 0;
  const remainingSpins = Math.max(0, 3 - spinsToday); // 3 free spins per day

  return {
    slices: slices.map(s => ({
      id: s.id,
      sliceIndex: s.slice_index,
      label: s.label,
      rewardType: s.reward_type,
      rewardValue: parseFloat(s.reward_value),
      probabilityWeight: s.probability_weight,
      colorHex: s.color_hex,
    })),
    remainingSpins,
  };
}

// ── Play spin wheel (server-side probability calculation) ─────────────────────

async function playSpin(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check and update spin count
    const { rows: spinData } = await client.query(
      `SELECT spins_today, last_spin_date
       FROM user_spins
       WHERE user_id = $1 AND last_spin_date = CURRENT_DATE
       FOR UPDATE`,
      [userId]
    );

    let spinsToday = spinData[0]?.spins_today || 0;
    const lastSpinDate = spinData[0]?.last_spin_date;

    // Reset count if it's a new day
    if (!lastSpinDate || new Date(lastSpinDate).toDateString() !== new Date().toDateString()) {
      spinsToday = 0;
    }

    if (spinsToday >= 3) {
      throw new AppError('No spins remaining today. Come back tomorrow!', 400, 'NO_SPINS');
    }

    // Update or insert spin record
    if (spinData.length > 0) {
      await client.query(
        `UPDATE user_spins SET spins_today = spins_today + 1 WHERE user_id = $1`,
        [userId]
      );
    } else {
      await client.query(
        `INSERT INTO user_spins (user_id, spins_today, last_spin_date) VALUES ($1, 1, CURRENT_DATE)`,
        [userId]
      );
    }

    // Get active slices with probability weights
    const { rows: slices } = await client.query(
      `SELECT id, slice_index, label, reward_type, reward_value, probability_weight, color_hex
       FROM wheel_slices
       WHERE is_active = true
       ORDER BY slice_index ASC`
    );

    // Calculate winning slice based on probability weights
    const totalWeight = slices.reduce((sum, s) => sum + s.probability_weight, 0);
    let random = Math.random() * totalWeight;
    let winningSlice = slices[0];

    for (const slice of slices) {
      random -= slice.probability_weight;
      if (random <= 0) {
        winningSlice = slice;
        break;
      }
    }

    // Award reward
    let reward = null;
    if (winningSlice.reward_type === 'COINS') {
      // Add coins to user
      await client.query(
        `UPDATE users SET coins = COALESCE(coins, 0) + $1 WHERE id = $2`,
        [winningSlice.reward_value, userId]
      );
      reward = {
        type: 'COINS',
        value: winningSlice.reward_value,
      };
    } else if (winningSlice.reward_type === 'COUPON') {
      // Create or find coupon for this reward
      const discountType = winningSlice.label.includes('%') ? 'PERCENT' : 'FIXED';
      const discountValue = winningSlice.reward_value;

      // Check if coupon already exists for this slice
      let couponId;
      const { rows: existingCoupon } = await client.query(
        `SELECT id FROM coupons WHERE code = $1`,
        [`SPIN-${winningSlice.label.toUpperCase().replace(/\s/g, '-')}`]
      );

      if (existingCoupon.length > 0) {
        couponId = existingCoupon[0].id;
      } else {
        // Create new coupon
        const { rows: newCoupon } = await client.query(
          `INSERT INTO coupons (code, discount_type, discount_value, min_order_cents, max_discount_cents, usage_limit, is_active)
           VALUES ($1, $2, $3, 0, 0, 10000, true)
           RETURNING id`,
          [`SPIN-${winningSlice.label.toUpperCase().replace(/\s/g, '-')}`, discountType, discountValue]
        );
        couponId = newCoupon[0].id;
      }

      // Claim coupon for user
      await client.query(
        `INSERT INTO user_coupons (user_id, coupon_id, is_used) VALUES ($1, $2, false)`,
        [userId, couponId]
      );

      reward = {
        type: 'COUPON',
        value: winningSlice.reward_value,
        discountType,
        couponCode: `SPIN-${winningSlice.label.toUpperCase().replace(/\s/g, '-')}`,
      };
    }

    await client.query('COMMIT');

    return {
      winningSliceIndex: winningSlice.slice_index,
      winningSlice: {
        label: winningSlice.label,
        rewardType: winningSlice.reward_type,
        rewardValue: winningSlice.reward_value,
        colorHex: winningSlice.color_hex,
      },
      reward,
      remainingSpins: 3 - spinsToday - 1,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Get user's claimed coupons ─────────────────────────────────────────────────

async function getUserCoupons(userId) {
  const { rows } = await pool.query(
    `SELECT uc.id, uc.is_used, uc.used_at, uc.claimed_at,
            c.code, c.discount_type, c.discount_value, c.min_order_cents, c.max_discount_cents, c.expires_at, c.is_active
     FROM user_coupons uc
     JOIN coupons c ON uc.coupon_id = c.id
     WHERE uc.user_id = $1
     ORDER BY uc.claimed_at DESC`,
    [userId]
  );

  return rows.map(r => ({
    id: r.id,
    code: r.code,
    discountType: r.discount_type,
    discountValue: parseFloat(r.discount_value),
    minOrderCents: r.min_order_cents,
    maxDiscountCents: r.max_discount_cents,
    expiresAt: r.expires_at,
    isActive: r.is_active,
    isUsed: r.is_used,
    usedAt: r.used_at,
    claimedAt: r.claimed_at,
  }));
}

// ── Claim coupon by promo code ─────────────────────────────────────────────────

async function claimCoupon(userId, code) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find coupon
    const { rows: coupon } = await client.query(
      `SELECT id, discount_type, discount_value, min_order_cents, max_discount_cents, expires_at, usage_limit, used_count, is_active
       FROM coupons
       WHERE code = $1 AND is_active = true`,
      [code.toUpperCase()]
    );

    if (coupon.length === 0) {
      throw new AppError('Invalid coupon code', 404, 'INVALID_COUPON');
    }

    const c = coupon[0];

    // Check if expired
    if (c.expires_at && new Date(c.expires_at) < new Date()) {
      throw new AppError('This coupon has expired', 400, 'EXPIRED_COUPON');
    }

    // Check if usage limit reached
    if (c.used_count >= c.usage_limit) {
      throw new AppError('This coupon has reached its usage limit', 400, 'LIMIT_REACHED');
    }

    // Check if user already claimed
    const { rows: existing } = await client.query(
      `SELECT id FROM user_coupons WHERE user_id = $1 AND coupon_id = $2`,
      [userId, c.id]
    );

    if (existing.length > 0) {
      throw new AppError('You have already claimed this coupon', 400, 'ALREADY_CLAIMED');
    }

    // Claim coupon
    await client.query(
      `INSERT INTO user_coupons (user_id, coupon_id, is_used) VALUES ($1, $2, false)`,
      [userId, c.id]
    );

    // Increment used count
    await client.query(
      `UPDATE coupons SET used_count = used_count + 1 WHERE id = $1`,
      [c.id]
    );

    await client.query('COMMIT');

    return {
      id: c.id,
      code: c.code,
      discountType: c.discount_type,
      discountValue: parseFloat(c.discount_value),
      minOrderCents: c.min_order_cents,
      maxDiscountCents: c.max_discount_cents,
      expiresAt: c.expires_at,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Admin: Get wheel configuration ────────────────────────────────────────────

async function getAdminWheelConfig() {
  const { rows: slices } = await pool.query(
    `SELECT id, slice_index, label, reward_type, reward_value, probability_weight, color_hex, is_active
     FROM wheel_slices
     ORDER BY slice_index ASC`
  );

  return slices.map(s => ({
    id: s.id,
    sliceIndex: s.slice_index,
    label: s.label,
    rewardType: s.reward_type,
    rewardValue: parseFloat(s.reward_value),
    probabilityWeight: s.probability_weight,
    colorHex: s.color_hex,
    isActive: s.is_active,
  }));
}

// ── Admin: Update wheel configuration ──────────────────────────────────────────

async function updateWheelConfig(slices) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const slice of slices) {
      await client.query(
        `UPDATE wheel_slices
         SET label = $1, reward_type = $2, reward_value = $3, probability_weight = $4, color_hex = $5, is_active = $6
         WHERE id = $7`,
        [slice.label, slice.rewardType, slice.rewardValue, slice.probabilityWeight, slice.colorHex, slice.isActive, slice.id]
      );
    }

    await client.query('COMMIT');
    return { success: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  getWheelConfig,
  playSpin,
  getUserCoupons,
  claimCoupon,
  getAdminWheelConfig,
  updateWheelConfig,
};
