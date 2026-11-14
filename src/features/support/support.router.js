const { Router } = require('express');
const { authenticate, requireStaff, requireSuperAdmin } = require('../../core/middleware/auth');
const ctrl = require('./support.controller');

const router = Router();

/**
 * Optional auth: guests (no Authorization header) pass through with req.user undefined,
 * logged-in users and admins are authenticated normally so req.user.role is available.
 * This is what lets the server tell a staff reply from a customer reply.
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return next();
  return authenticate(req, res, next);
}

// ── Static routes MUST come before /:id to avoid Express swallowing them ──────

// Settings
router.get('/settings', ctrl.getSupportSettings);
router.put('/admin/settings', authenticate, requireStaff, ctrl.updateSupportSettings);

// Default messages (canned responses)
router.get('/default-messages', authenticate, requireStaff, ctrl.getDefaultMessages);
router.post('/default-messages', authenticate, requireStaff, ctrl.addDefaultMessage);
router.patch('/default-messages/:id', authenticate, requireStaff, ctrl.editDefaultMessage);
router.delete('/default-messages/:id', authenticate, requireStaff, ctrl.removeDefaultMessage);

// My tickets (customer OR guest identified by guestId / x-device-id)
router.get('/my-tickets', optionalAuth, ctrl.getMyTickets);

// Ticket list (admin) + create (customer or guest)
router.get('/', authenticate, requireStaff, ctrl.getTickets);
router.post('/', optionalAuth, ctrl.createTicket);

// Conversation history + staff list (Super Admin only)
router.get('/conversation-history', authenticate, requireSuperAdmin, ctrl.getConversationHistory);
router.get('/staff-users', authenticate, requireStaff, ctrl.getStaffUsers);

// Image upload (guests can use this for chat images, rate-limited)
const { createRateLimiter } = require('../../core/middleware/rate_limiter');
const chatImageUploadLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyFn: (req) => `chat-upload|${req.ip}`,
  message: 'Too many image uploads. Please try again later.',
  code: 'TOO_MANY_UPLOADS',
  hideRemaining: true,
});
router.post('/upload-image', chatImageUploadLimiter, optionalAuth, ctrl.uploadChatImage);

// ── Parameterised routes LAST ─────────────────────────────────────────────────
router.get('/:id', optionalAuth, ctrl.getOne);
router.post('/:id/reply', optionalAuth, ctrl.reply);
router.patch('/:id/status', authenticate, requireStaff, ctrl.setStatus);
router.post('/:id/read', optionalAuth, ctrl.markRead);
router.post('/:id/typing', optionalAuth, ctrl.setTyping);
router.get('/:id/typing', ctrl.typingStatus);
router.delete('/:id', authenticate, requireStaff, ctrl.deleteTicket);

module.exports = router;
