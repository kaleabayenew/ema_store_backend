const { Router } = require('express');
const ctrl = require('./notifications.controller');
const { requireAuth } = require('../../core/middleware/auth');

const router = Router();

// ── FCM Token Management ─────────────────────────────────────────────────────
router.post('/fcm-token', requireAuth, ctrl.updateFcmToken);

// ── Notification Retrieval ─────────────────────────────────────────────────────
router.get('/', requireAuth, ctrl.getNotifications);
router.patch('/:id/read', requireAuth, ctrl.markAsRead);
router.patch('/read-all', requireAuth, ctrl.markAllAsRead);
router.delete('/:id', requireAuth, ctrl.deleteNotification);

// ── Admin: Send Announcements ───────────────────────────────────────────────
router.post('/announce', requireAuth, ctrl.sendAnnouncement);
// ── Admin: Get all notifications ────────────────────────────────────────────
router.get('/admin/all', requireAuth, ctrl.getAllNotifications);

module.exports = router;
