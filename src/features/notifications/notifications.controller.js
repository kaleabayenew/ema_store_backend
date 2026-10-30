const service = require('./notifications.service');
const { ok, error } = require('../../core/utils/response');
const { requireAuth } = require('../../core/middleware/auth');

// ── POST /api/v1/notifications/fcm-token
// Body: { fcmToken }
// Updates the user's FCM token for push notifications
const updateFcmToken = async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user?.id; // From auth middleware

    if (!fcmToken) {
      return error(res, 'FCM token is required.', 400, 'MISSING_TOKEN');
    }

    if (!userId) {
      return error(res, 'Authentication required.', 401, 'UNAUTHORIZED');
    }

    const result = await service.updateFcmToken(userId, fcmToken);

    ok(res, {
      message: 'FCM token updated successfully',
      fcmToken: result.fcm_token,
    });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/v1/notifications
// Query: ?limit=20&offset=0
// Get user's notifications with pagination
const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return error(res, 'Authentication required.', 401, 'UNAUTHORIZED');
    }

    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const notifications = await service.getUserNotifications(userId, { limit, offset });

    ok(res, {
      notifications,
      limit,
      offset,
      count: notifications.length,
    });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/v1/notifications/:id/read
// Mark a specific notification as read
const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return error(res, 'Authentication required.', 401, 'UNAUTHORIZED');
    }

    const notification = await service.markAsRead(id, userId);

    ok(res, {
      message: 'Notification marked as read',
      notification,
    });
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/v1/notifications/read-all
// Mark all notifications as read
const markAllAsRead = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return error(res, 'Authentication required.', 401, 'UNAUTHORIZED');
    }

    const result = await service.markAllAsRead(userId);

    ok(res, {
      message: 'All notifications marked as read',
      markedCount: result.markedCount,
    });
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/v1/notifications/:id
// Delete a notification
const deleteNotification = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return error(res, 'Authentication required.', 401, 'UNAUTHORIZED');
    }

    await service.deleteNotification(id, userId);

    ok(res, { message: 'Notification deleted' });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/v1/notifications/announce (Admin only)
// Body: { title, body, targetRole? }
// Send announcement to all users or specific role
const sendAnnouncement = async (req, res, next) => {
  try {
    const { title, body, targetRole } = req.body;
    const userId = req.user?.id;

    if (!title || !body) {
      return error(res, 'Title and body are required.', 400, 'MISSING_FIELDS');
    }

    // TODO: Verify admin role from middleware
    // if (req.user?.role !== 'ADMIN') {
    //   return error(res, 'Admin access required.', 403, 'FORBIDDEN');
    // }

    const result = await service.sendAnnouncement({
      title,
      body,
      targetRole,
    });

    ok(res, {
      message: 'Announcement sent successfully',
      sentCount: result.sentCount,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  updateFcmToken,
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  sendAnnouncement,
};
