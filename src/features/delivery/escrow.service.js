const { pool } = require('../../core/config/database');
const { safeSendNotification } = require('../orders/order_flow');

// ─────────────────────────────────────────────────────────────────────────────
//  Order escrow payouts.
//  - Partner share = Σ(item price × qty − commission) per partner.
//  - Rider share   = delivery fee − rider commission (legacy: 10% of total).
//  Milestones: 50% of each partner share when the rider picks up the goods,
//  remaining 50% + the full rider share when the customer accepts delivery.
//  Every disbursement writes a COMPLETED wallet_transactions row so it shows
//  up in the partner wallet / rider earnings immediately.
// ─────────────────────────────────────────────────────────────────────────────

async function ensureEscrowSchema(db = pool) {
  const { ensureOrderFlowSchema } = require('../orders/order_flow');
  await ensureOrderFlowSchema(db);
}

/** Per-partner net share (product revenue minus commission) for an order. */
async function partnerShares(client, orderId) {
  const { rows } = await client.query(
    `SELECT p.partner_id,
            COALESCE(SUM(COALESCE(oi.price_at_order, 0) * oi.quantity
                        - COALESCE(oi.commission_cents, 0)), 0)::bigint AS share_cents
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1
     GROUP BY p.partner_id`,
    [orderId],
  );
  return rows.map((r) => ({ partnerId: r.partner_id, shareCents: Number(r.share_cents) }));
}

/** Rider net share for an order (fee minus commission; legacy 10% fallback). */
async function riderShareCents(client, order) {
  const fee = Number(order.delivery_fee_cents) || 0;
  if (fee > 0) {
    return Math.max(0, fee - (Number(order.rider_commission_cents) || 0));
  }
  const total = Number(order.total_cents) || Math.round(Number(order.total_amount || 0) * 100);
  return Math.round(total * 0.10);
}

async function upsertPayout(client, { orderId, payeeType, payeeId, shareCents }) {
  const { rows } = await client.query(
    `INSERT INTO order_payouts (order_id, payee_type, payee_id, share_cents)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (order_id, payee_type, payee_id)
     DO UPDATE SET share_cents = GREATEST(order_payouts.share_cents, EXCLUDED.share_cents),
                   updated_at = NOW()
     RETURNING *`,
    [orderId, payeeType, payeeId, shareCents],
  );
  return rows[0];
}

async function recordPayout(client, { userId, amountCents, title, description, metadata }) {
  if (!userId || amountCents <= 0) return;
  await client.query(
    `INSERT INTO wallet_transactions (user_id, amount, title, description, type, status, metadata)
     VALUES ($1, $2, $3, $4, 'ORDER_PAYOUT', 'COMPLETED', $5)`,
    [userId, amountCents / 100, title, description, JSON.stringify(metadata || {})],
  );
}

function fmt(cents) {
  return `ETB ${(cents / 100).toFixed(2)}`;
}

/**
 * Pickup milestone — deposit 50% of every partner's share.
 * Must run inside the caller's transaction (client already BEGIN'd).
 */
async function settlePickupPayouts(client, order) {
  await ensureEscrowSchema(client);
  const orderId = order.id;
  const shares = await partnerShares(client, orderId);
  const results = [];

  for (const share of shares) {
    if (share.shareCents <= 0 || !share.partnerId) continue;
    const payout = await upsertPayout(client, {
      orderId, payeeType: 'PARTNER', payeeId: share.partnerId, shareCents: share.shareCents,
    });
    const target = Math.ceil(share.shareCents * 0.5);
    const delta = Math.min(target - payout.paid_cents, share.shareCents - payout.paid_cents);
    if (delta <= 0) { results.push({ partnerId: share.partnerId, paidCents: 0 }); continue; }

    await recordPayout(client, {
      userId: share.partnerId,
      amountCents: delta,
      title: 'Order payout — pickup (50%)',
      description: `50% of your share for order ${order.delivery_code || String(orderId).slice(0, 8)} deposited to your wallet.`,
      metadata: { orderId, milestone: 'PICKUP', shareCents: share.shareCents, paidCents: delta },
    });
    await client.query(
      `UPDATE order_payouts SET paid_cents = paid_cents + $1, updated_at = NOW() WHERE id = $2`,
      [delta, payout.id],
    );
    results.push({ partnerId: share.partnerId, paidCents: delta });
  }

  // Notifications (fire-and-forget, outside the tx-critical path but cheap)
  for (const r of results) {
    if (r.paidCents > 0) {
      safeSendNotification(
        r.partnerId,
        'Payout Deposited — 50%',
        `${fmt(r.paidCents)} (50% of your order share) was deposited to your wallet for order ${order.delivery_code || String(orderId).slice(0, 8)}.`,
        { orderId, type: 'ORDER_PAYOUT', milestone: 'PICKUP' },
      );
    }
  }
  return results;
}

/**
 * Delivery milestone — deposit remaining partner share + full rider share.
 * Must run inside the caller's transaction.
 */
async function settleDeliveryPayouts(client, order) {
  await ensureEscrowSchema(client);
  const orderId = order.id;
  const results = { partners: [], rider: null };

  // Remaining partner balances
  const shares = await partnerShares(client, orderId);
  for (const share of shares) {
    if (share.shareCents <= 0 || !share.partnerId) continue;
    const payout = await upsertPayout(client, {
      orderId, payeeType: 'PARTNER', payeeId: share.partnerId, shareCents: share.shareCents,
    });
    const delta = share.shareCents - payout.paid_cents;
    if (delta <= 0) { results.partners.push({ partnerId: share.partnerId, paidCents: 0 }); continue; }

    await recordPayout(client, {
      userId: share.partnerId,
      amountCents: delta,
      title: 'Order payout — delivery complete',
      description: `Remaining ${fmt(delta)} of your share for order ${order.delivery_code || String(orderId).slice(0, 8)} deposited to your wallet.`,
      metadata: { orderId, milestone: 'DELIVERY', shareCents: share.shareCents, paidCents: delta },
    });
    await client.query(
      `UPDATE order_payouts SET paid_cents = paid_cents + $1, updated_at = NOW() WHERE id = $2`,
      [delta, payout.id],
    );
    results.partners.push({ partnerId: share.partnerId, paidCents: delta });
  }

  // Rider share — resolve the agent's user account via phone (same join the
  // delivery notifications already use).
  if (order.delivery_agent_id) {
    const riderCents = await riderShareCents(client, order);
    if (riderCents > 0) {
      const { rows: agentUser } = await client.query(
        `SELECT u.id AS user_id, da.full_name
         FROM delivery_agents da JOIN users u ON u.phone = da.phone
         WHERE da.id = $1`,
        [order.delivery_agent_id],
      );
      const userId = agentUser[0]?.user_id || null;
      const payout = await upsertPayout(client, {
        orderId, payeeType: 'RIDER', payeeId: order.delivery_agent_id, shareCents: riderCents,
      });
      const delta = riderCents - payout.paid_cents;
      if (delta > 0) {
        await recordPayout(client, {
          userId,
          amountCents: delta,
          title: 'Delivery payout — order completed',
          description: `Your delivery earning of ${fmt(delta)} for order ${order.delivery_code || String(orderId).slice(0, 8)} was deposited to your wallet.`,
          metadata: { orderId, milestone: 'DELIVERY', shareCents: riderCents, paidCents: delta },
        });
        await client.query(
          `UPDATE order_payouts SET paid_cents = paid_cents + $1, updated_at = NOW() WHERE id = $2`,
          [delta, payout.id],
        );
        results.rider = { agentId: order.delivery_agent_id, paidCents: delta, userId };
      }
    }
  }

  // Notifications
  for (const r of results.partners) {
    if (r.paidCents > 0) {
      safeSendNotification(
        r.partnerId,
        'Payout Deposited — Final 50%',
        `${fmt(r.paidCents)} (remaining share) was deposited to your wallet for order ${order.delivery_code || String(orderId).slice(0, 8)}.`,
        { orderId, type: 'ORDER_PAYOUT', milestone: 'DELIVERY' },
      );
    }
  }
  if (results.rider?.paidCents > 0) {
    safeSendNotification(
      order.user_id,
      'Delivery completed',
      `Order ${order.delivery_code || String(orderId).slice(0, 8)} delivered — rider payout of ${fmt(results.rider.paidCents)} settled.`,
      { orderId, type: 'ORDER_PAYOUT', milestone: 'DELIVERY' },
    );
    if (results.rider.userId) {
      safeSendNotification(
        results.rider.userId,
        'Rider Payout Deposited',
        `${fmt(results.rider.paidCents)} delivery earning was deposited to your wallet for order ${order.delivery_code || String(orderId).slice(0, 8)}.`,
        { orderId, type: 'RIDER_PAYOUT', milestone: 'DELIVERY' },
      );
    }
  }
  return results;
}

module.exports = { settlePickupPayouts, settleDeliveryPayouts, ensureEscrowSchema };
