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

    // Full sync: update existing rows (order = array position), insert new ones
    // (id missing/0), and delete rows the admin removed.
    const keepIds = [];
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i];
      const sliceIndex = i + 1;
      const id = parseInt(slice.id, 10);
      if (id > 0) {
        keepIds.push(id);
        await client.query(
          `UPDATE wheel_slices
           SET slice_index = $1, label = $2, reward_type = $3, reward_value = $4, probability_weight = $5, color_hex = $6, is_active = $7
           WHERE id = $8`,
          [sliceIndex, slice.label, slice.rewardType, slice.rewardValue, slice.probabilityWeight, slice.colorHex, slice.isActive, id]
        );
      } else {
        const { rows } = await client.query(
          `INSERT INTO wheel_slices (slice_index, label, reward_type, reward_value, probability_weight, color_hex, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [sliceIndex, slice.label, slice.rewardType, slice.rewardValue, slice.probabilityWeight, slice.colorHex, slice.isActive !== false]
        );
        keepIds.push(rows[0].id);
      }
    }

    if (keepIds.length > 0) {
      await client.query('DELETE FROM wheel_slices WHERE id <> ALL($1::int[])', [keepIds]);
    } else {
      await client.query('DELETE FROM wheel_slices');
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

// ── Admin: List all coupons ───────────────────────────────────────────────────

async function getAdminCoupons() {
  const { rows } = await pool.query(
    `SELECT c.*,
            COUNT(uc.id) FILTER (WHERE uc.is_used = false)  AS claimed_count,
            COUNT(uc.id) FILTER (WHERE uc.is_used = true)   AS redeemed_count
     FROM coupons c
     LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
     GROUP BY c.id
     ORDER BY c.created_at DESC`
  );
  return rows.map(r => ({
    id: r.id,
    code: r.code,
    discountType: r.discount_type,
    discountValue: parseFloat(r.discount_value),
    minOrderCents: r.min_order_cents,
    maxDiscountCents: r.max_discount_cents,
    expiresAt: r.expires_at,
    usageLimit: r.usage_limit,
    usedCount: r.used_count,
    claimedCount: parseInt(r.claimed_count, 10),
    redeemedCount: parseInt(r.redeemed_count, 10),
    isActive: r.is_active,
    createdAt: r.created_at,
  }));
}

// ── Admin: Create coupon ──────────────────────────────────────────────────────

async function createCoupon(data) {
  const { rows } = await pool.query(
    `INSERT INTO coupons
       (code, discount_type, discount_value, min_order_cents, max_discount_cents,
        expires_at, usage_limit, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      data.code,
      data.discountType,
      data.discountValue,
      data.minOrderCents ?? 0,
      data.maxDiscountCents ?? 0,
      data.expiresAt || null,
      data.usageLimit ?? 1000,
      data.isActive !== false,
    ]
  );
  return rows[0];
}

// ── Admin: Update coupon ──────────────────────────────────────────────────────

async function updateCoupon(id, data) {
  const { rows } = await pool.query(
    `UPDATE coupons SET
       code                = COALESCE($1, code),
       discount_type       = COALESCE($2, discount_type),
       discount_value      = COALESCE($3, discount_value),
       min_order_cents     = COALESCE($4, min_order_cents),
       max_discount_cents  = COALESCE($5, max_discount_cents),
       expires_at          = COALESCE($6, expires_at),
       usage_limit         = COALESCE($7, usage_limit),
       is_active           = COALESCE($8, is_active)
     WHERE id = $9
     RETURNING *`,
    [
      data.code ?? null,
      data.discountType ?? null,
      data.discountValue ?? null,
      data.minOrderCents ?? null,
      data.maxDiscountCents ?? null,
      data.expiresAt ?? null,
      data.usageLimit ?? null,
      data.isActive ?? null,
      id,
    ]
  );
  if (rows.length === 0) {
    throw new AppError('Coupon not found', 404, 'NOT_FOUND');
  }
  return rows[0];
}

// ── Admin: Delete coupon ──────────────────────────────────────────────────────

async function deleteCoupon(id) {
  const { rowCount } = await pool.query('DELETE FROM coupons WHERE id = $1', [id]);
  if (rowCount === 0) {
    throw new AppError('Coupon not found', 404, 'NOT_FOUND');
  }
}

// ── Compute the discount (in cents) a coupon gives on a subtotal ─────────────

function computeCouponDiscountCents(coupon, subtotalCents) {
  if (!coupon || subtotalCents <= 0) return 0;
  let discount;
  if (coupon.discount_type === 'PERCENT') {
    discount = Math.round(subtotalCents * (parseFloat(coupon.discount_value) / 100));
  } else {
    // FIXED value is stored in whole Birr → cents
    discount = Math.round(parseFloat(coupon.discount_value) * 100);
  }
  if (coupon.max_discount_cents > 0) {
    discount = Math.min(discount, coupon.max_discount_cents);
  }
  return Math.min(discount, subtotalCents);
}

// Validate a coupon the user wants to redeem on an order. Returns
// { coupon, userCoupon, discountCents } or throws AppError.
async function validateCouponForOrder(userId, code, subtotalCents, client = pool) {
  const { rows } = await client.query(
    `SELECT c.*, uc.id AS user_coupon_id, uc.is_used AS user_coupon_used
     FROM coupons c
     JOIN user_coupons uc ON uc.coupon_id = c.id AND uc.user_id = $1
     WHERE c.code = $2`,
    [userId, String(code || '').trim().toUpperCase()]
  );
  if (rows.length === 0) {
    throw new AppError('Coupon not found or not claimed by you', 400, 'INVALID_COUPON');
  }
  const row = rows[0];

  if (!row.is_active) throw new AppError('This coupon is no longer active', 400, 'COUPON_INACTIVE');
  if (row.user_coupon_used) throw new AppError('You already used this coupon', 400, 'COUPON_USED');
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    throw new AppError('This coupon has expired', 400, 'EXPIRED_COUPON');
  }
  if (row.usage_limit > 0 && row.used_count >= row.usage_limit) {
    throw new AppError('This coupon has reached its usage limit', 400, 'LIMIT_REACHED');
  }
  if (subtotalCents < (row.min_order_cents || 0)) {
    throw new AppError(
      `Minimum order of ETB ${(row.min_order_cents / 100).toFixed(0)} required for this coupon`,
      400, 'MIN_ORDER_NOT_MET'
    );
  }

  return {
    coupon: row,
    userCouponId: row.user_coupon_id,
    discountCents: computeCouponDiscountCents(row, subtotalCents),
  };
}

// Mark a user coupon as used (call inside the order transaction).
async function markCouponUsed(userCouponId, orderId, client) {
  await client.query(
    `UPDATE user_coupons SET is_used = true, used_at = NOW() WHERE id = $1`,
    [userCouponId]
  );
  const { rows } = await client.query('SELECT coupon_id FROM user_coupons WHERE id = $1', [userCouponId]);
  if (rows.length > 0) {
    await client.query(
      `UPDATE coupons SET used_count = used_count + 1 WHERE id = $1`,
      [rows[0].coupon_id]
    );
  }
}

module.exports = {
  getWheelConfig,
  playSpin,
  getUserCoupons,
  claimCoupon,
  getAdminWheelConfig,
  updateWheelConfig,
  getAdminCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  computeCouponDiscountCents,
  validateCouponForOrder,
  markCouponUsed,
};
