const { Router } = require('express');
const { authenticate } = require('../../core/middleware/auth');
const ctrl = require('./support.controller');

const router = Router();

// ── Static routes MUST come before /:id to avoid Express swallowing them ──────

// Settings
router.get('/settings',                 ctrl.getSupportSettings);
router.put('/admin/settings',           authenticate, ctrl.updateSupportSettings);

// Default messages (canned responses)
router.get('/default-messages',         authenticate, ctrl.getDefaultMessages);
router.post('/default-messages',        authenticate, ctrl.addDefaultMessage);
router.patch('/default-messages/:id',   authenticate, ctrl.editDefaultMessage);
router.delete('/default-messages/:id',  authenticate, ctrl.removeDefaultMessage);

// My tickets (customer)
router.get('/my-tickets',               authenticate, ctrl.getMyTickets);

// Ticket list + create
router.get('/',                         authenticate, ctrl.getTickets);
router.post('/',                        ctrl.createTicket); // Allow guest tickets

// Conversation history + staff list (Super Admin only)
router.get('/conversation-history',  authenticate, ctrl.getConversationHistory);
router.get('/staff-users',           authenticate, ctrl.getStaffUsers);

// ── Parameterised routes LAST ─────────────────────────────────────────────────
router.get('/:id',                      ctrl.getOne); // Allow guest access
router.post('/:id/reply',               ctrl.reply); // Allow guest replies
router.patch('/:id/status',             authenticate, ctrl.setStatus);
router.post('/:id/read',                ctrl.markRead);
router.post('/:id/typing',              ctrl.setTyping);
router.get('/:id/typing',               ctrl.typingStatus);

module.exports = router;
