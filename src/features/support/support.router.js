const { Router } = require('express');
const { authenticate } = require('../../core/middleware/auth');
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
router.get('/settings',                 ctrl.getSupportSettings);
router.put('/admin/settings',           authenticate, ctrl.updateSupportSettings);

// Default messages (canned responses)
router.get('/default-messages',         authenticate, ctrl.getDefaultMessages);
router.post('/default-messages',        authenticate, ctrl.addDefaultMessage);
router.patch('/default-messages/:id',   authenticate, ctrl.editDefaultMessage);
router.delete('/default-messages/:id',  authenticate, ctrl.removeDefaultMessage);

// My tickets (customer OR guest identified by guestId / x-device-id)
router.get('/my-tickets',               optionalAuth, ctrl.getMyTickets);

// Ticket list (admin) + create (customer or guest)
router.get('/',                         authenticate, ctrl.getTickets);
router.post('/',                        optionalAuth, ctrl.createTicket);

// Conversation history + staff list (Super Admin only)
router.get('/conversation-history',     authenticate, ctrl.getConversationHistory);
router.get('/staff-users',              authenticate, ctrl.getStaffUsers);

// ── Parameterised routes LAST ─────────────────────────────────────────────────
router.get('/:id',                      optionalAuth, ctrl.getOne);
router.post('/:id/reply',               optionalAuth, ctrl.reply);
router.patch('/:id/status',             authenticate, ctrl.setStatus);
router.post('/:id/read',                optionalAuth, ctrl.markRead);
router.post('/:id/typing',              optionalAuth, ctrl.setTyping);
router.get('/:id/typing',               ctrl.typingStatus);

module.exports = router;
