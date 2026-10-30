const { pool }                          = require('../../core/config/database');
const { sendPush, sendMulticastPush }   = require('../../core/config/firebase');
const { AppError }                      = require('../../core/errors/app_error');

// ─────────────────────────────────────────────────────────────────────────────
//  Notification Types
// ─────────────────────────────────────────────────────────────────────────────
const NotificationTypes = {
  ORDER_PLACED:     'ORDER_PLACED',
  ORDER_CONFIRMED:  'ORDER_CONFIRMED',
  ORDER_SHIPPED:    'ORDER_SHIPPED',
  ORDER_DELIVERED:  'ORDER_DELIVERED',
  ORDER_CANCELLED:  'ORDER_CANCELLED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  PRODUCT_APPROVED: 'PRODUCT_APPROVED',
  PRODUCT_REJECTED: 'PRODUCT_REJECTED',
  PARTNER_APPROVED: 'PARTNER_APPROVED',
  PROMO_DEAL:       'PROMO_DEAL',
  ANNOUNCEMENT:     'ANNOUNCEMENT',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Low-level DB helpers
// ─────────────────────────────────────────────────────────────────────────────

async function saveNotificationToDB({ userId, title, body, data = {} }) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, title, body, data)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [userId, title, body, JSON.stringify(data)],
  );
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Core send  (DB + FCM push)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save a notification to DB and send an FCM push to the user's device.
 * If the user's FCM token is invalid, it is cleared from the DB automatically.
 */
async function sendNotification({ userId, title, body, data = {}, sendPushFlag = true }) {
  // 1. Get user's FCM token
  const { rows: userRows } = await pool.query(
    `SELECT fcm_token FROM users WHERE id = $1`,
    [userId],
  );
  const user = userRows[0];
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  // 2. Persist to DB
  const dbRecord = await saveNotificationToDB({ userId, title, body, data });

  // 3. Push
  if (sendPushFlag && user.fcm_token) {
    const result = await sendPush(user.fcm_token, { title, body }, data);

    // Auto-clear stale token
    if (result === 'INVALID_TOKEN') {
      await pool.query(
        `UPDATE users SET fcm_token = NULL, updated_at = NOW() WHERE id = $1`,
        [userId],
      );
    }
  }

  return dbRecord;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Broadcast to a role
// ─────────────────────────────────────────────────────────────────────────────

async function broadcastToRole({ role, title, body, data = {} }) {
  const { rows } = await pool.query(
    `SELECT id, fcm_token FROM users WHERE role = $1`,
    [role],
  );

  // Persist for all users in parallel
  await Promise.all(rows.map((u) =>
    saveNotificationToDB({ userId: u.id, title, body, data }),
  ));

  // Push to those who have a token
  const tokens = rows.map((u) => u.fcm_token).filter(Boolean);
  if (tokens.length > 0) {
    await sendMulticastPush(tokens, { title, body }, data);
  }

  return { sentCount: rows.length };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Broadcast to ALL users
// ─────────────────────────────────────────────────────────────────────────────

async function broadcastToAll({ title, body, data = {} }) {
  const { rows } = await pool.query(`SELECT id, fcm_token FROM users`);

  await Promise.all(rows.map((u) =>
    saveNotificationToDB({ userId: u.id, title, body, data }),
  ));

  const tokens = rows.map((u) => u.fcm_token).filter(Boolean);
  if (tokens.length > 0) {
    await sendMulticastPush(tokens, { title, body }, data);
  }

  return { sentCount: rows.length };
}

// ─────────────────────────────────────────────────────────────────────────────
//  FCM Token management
// ─────────────────────────────────────────────────────────────────────────────

async function updateFcmToken(userId, fcmToken) {
  const { rows } = await pool.query(
    `UPDATE users
     SET fcm_token = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING id, fcm_token`,
    [userId, fcmToken],
  );
  if (rows.length === 0) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Inbox management
// ─────────────────────────────────────────────────────────────────────────────

async function getUserNotifications(userId, { limit = 20, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, title, body, data, is_read, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return rows;
}

async function markAsRead(notificationId, userId) {
  const { rows } = await pool.query(
    `UPDATE notifications
     SET is_read = true
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [notificationId, userId],
  );
  if (rows.length === 0) throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  return rows[0];
}

async function markAllAsRead(userId) {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
    [userId],
  );
  return { markedCount: rowCount };
}

async function deleteNotification(notificationId, userId) {
  const { rowCount } = await pool.query(
    `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
    [notificationId, userId],
  );
  if (rowCount === 0) throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Pre-built notification helpers  (call these from other features)
// ─────────────────────────────────────────────────────────────────────────────

async function notifyOrderPlaced(userId, orderNumber) {
  return sendNotification({
    userId,
    title: '🎉 Order Placed!',
    body:  `Your order #${orderNumber} has been confirmed. We'll notify you when it ships.`,
    data:  { type: NotificationTypes.ORDER_PLACED, orderNumber, channelId: 'eco_orders', targetRoute: '/orders' },
  });
}

async function notifyOrderConfirmed(userId, orderNumber) {
  return sendNotification({
    userId,
    title: '✅ Order Confirmed',
    body:  `Your order #${orderNumber} has been accepted by the seller.`,
    data:  { type: NotificationTypes.ORDER_CONFIRMED, orderNumber, channelId: 'eco_orders', targetRoute: '/orders' },
  });
}

async function notifyOrderShipped(userId, orderNumber) {
  return sendNotification({
    userId,
    title: '🚚 Order Shipped',
    body:  `Your order #${orderNumber} is on the way! Track it in the Orders tab.`,
    data:  { type: NotificationTypes.ORDER_SHIPPED, orderNumber, channelId: 'eco_orders', targetRoute: '/orders' },
  });
}

async function notifyOrderDelivered(userId, orderNumber) {
  return sendNotification({
    userId,
    title: '✓ Order Delivered',
    body:  `Your order #${orderNumber} has been delivered. Enjoy your purchase!`,
    data:  { type: NotificationTypes.ORDER_DELIVERED, orderNumber, channelId: 'eco_orders', targetRoute: '/orders' },
  });
}

async function notifyOrderCancelled(userId, orderNumber) {
  return sendNotification({
    userId,
    title: '❌ Order Cancelled',
    body:  `Your order #${orderNumber} has been cancelled.`,
    data:  { type: NotificationTypes.ORDER_CANCELLED, orderNumber, channelId: 'eco_orders', targetRoute: '/orders' },
  });
}

async function notifyProductApproved(userId, productName) {
  return sendNotification({
    userId,
    title: '✅ Product Approved',
    body:  `Your product "${productName}" is now live and visible to customers.`,
    data:  { type: NotificationTypes.PRODUCT_APPROVED, productName, channelId: 'eco_orders', targetRoute: '/partner/products' },
  });
}

async function notifyProductRejected(userId, productName, reason) {
  return sendNotification({
    userId,
    title: '❌ Product Rejected',
    body:  `Your product "${productName}" was rejected. Reason: ${reason}`,
    data:  { type: NotificationTypes.PRODUCT_REJECTED, productName, channelId: 'eco_orders', targetRoute: '/partner/products' },
  });
}

async function notifyPartnerApproved(userId, shopName) {
  return sendNotification({
    userId,
    title: '🏪 Shop Approved!',
    body:  `Congratulations! Your shop "${shopName}" is now live on Ema Store.`,
    data:  { type: NotificationTypes.PARTNER_APPROVED, shopName, channelId: 'eco_orders', targetRoute: '/partner' },
  });
}

async function sendAnnouncement({ title, body, targetRole = null }) {
  if (targetRole) {
    return broadcastToRole({
      role:  targetRole,
      title,
      body,
      data:  { type: NotificationTypes.ANNOUNCEMENT, channelId: 'eco_announcements' },
    });
  }
  return broadcastToAll({
    title,
    body,
    data: { type: NotificationTypes.ANNOUNCEMENT, channelId: 'eco_announcements' },
  });
}

module.exports = {
  sendNotification,
  broadcastToRole,
  broadcastToAll,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  updateFcmToken,
  notifyOrderPlaced,
  notifyOrderConfirmed,
  notifyOrderShipped,
  notifyOrderDelivered,
  notifyOrderCancelled,
  notifyProductApproved,
  notifyProductRejected,
  notifyPartnerApproved,
  sendAnnouncement,
  NotificationTypes,
};
