const {
  listTickets,
  getTicket,
  addReply,
  updateStatus,
  createTicket: createTicketService,
  getCustomerTickets,
  claimGuestTickets,
  getSupportSettings: fetchSupportSettings,
  updateSupportSettings: saveSupportSettings,
  listDefaultMessages,
  createDefaultMessage,
  updateDefaultMessage,
  deleteDefaultMessage,
  listConversationHistory,
  listStaffUsers,
  markMessagesRead,
  recordTyping,
  getTypingStatus,
} = require('./support.service');
const { ok } = require('../../core/utils/response');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Staff = any logged-in user whose role is not CUSTOMER / PARTNER. */
function isStaffUser(user) {
  if (!user) return false;
  const role = String(user.role || '').toUpperCase();
  return role !== '' && role !== 'CUSTOMER' && role !== 'PARTNER';
}

/** Stable guest identity sent by the app (device id). Body, query or header. */
function getGuestId(req) {
  const raw = req.body?.guestId || req.query?.guestId || req.headers['x-guest-id'] || req.headers['x-device-id'];
  const id = typeof raw === 'string' ? raw.trim() : '';
  return id ? id.slice(0, 128) : null;
}

// ── Tickets ───────────────────────────────────────────────────────────────────

async function getTickets(req, res, next) {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const result = await listTickets({ status, search, page: parseInt(page), limit: parseInt(limit) });
    ok(res, result);
  } catch (e) { next(e); }
}

async function getOne(req, res, next) {
  try {
    const ticket = await getTicket(req.params.id);
    ok(res, { ticket });
  } catch (e) { next(e); }
}

async function reply(req, res, next) {
  try {
    const body = req.body?.body;
    if (!body?.trim()) return res.status(400).json({ success: false, message: 'Reply body is required' });

    const staff = isStaffUser(req.user);
    const guestId = staff ? null : getGuestId(req);
    if (!staff && !req.user?.id && !guestId) {
      return res.status(400).json({ success: false, message: 'guestId is required for guest replies' });
    }

    const msg = await addReply(req.params.id, {
      senderId: req.user?.id || null,
      guestId,
      body: body.trim(),
      isStaff: staff,           // decided by the server from the login, never by the client
    });
    ok(res, { message: msg });
  } catch (e) { next(e); }
}

async function setStatus(req, res, next) {
  try {
    await updateStatus(req.params.id, req.body.status);
    ok(res, { message: 'Status updated' });
  } catch (e) { next(e); }
}

async function createTicket(req, res, next) {
  try {
    const { subject, message, priority = 'MEDIUM' } = req.body;
    const guestId = getGuestId(req);
    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).json({ success: false, message: 'Subject and message are required' });
    }
    if (!req.user?.id && !guestId) {
      return res.status(400).json({ success: false, message: 'guestId is required for guest tickets' });
    }
    const ticket = await createTicketService({
      userId: req.user?.id || null,
      guestId: guestId || null,
      subject: subject.trim(),
      initialMessage: message.trim(),
      priority,
    });
    res.status(201).json({ success: true, ticket });
  } catch (e) { next(e); }
}

async function getMyTickets(req, res, next) {
  try {
    const guestId = getGuestId(req);
    if (req.user?.id && guestId) await claimGuestTickets(req.user.id, guestId);
    const tickets = await getCustomerTickets(req.user?.id || null, guestId);
    ok(res, { tickets });
  } catch (e) { next(e); }
}

// Kept for backwards compatibility - reply() now handles customers and staff.
const customerReply = reply;

// ── Settings ──────────────────────────────────────────────────────────────────

async function getSupportSettings(req, res, next) {
  try {
    const settings = await fetchSupportSettings();
    ok(res, { data: settings });
  } catch (e) { next(e); }
}

async function updateSupportSettings(req, res, next) {
  try {
    const { welcomeMessage, isAutoReplyEnabled, quickStarters } = req.body;
    const settings = await saveSupportSettings({ welcomeMessage, isAutoReplyEnabled, quickStarters });
    ok(res, { data: settings });
  } catch (e) { next(e); }
}

// ── Default messages ──────────────────────────────────────────────────────────

async function getDefaultMessages(req, res, next) {
  try {
    const messages = await listDefaultMessages();
    ok(res, { messages });
  } catch (e) { next(e); }
}

async function addDefaultMessage(req, res, next) {
  try {
    const { title, body, sortOrder } = req.body;
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ success: false, message: 'Title and body are required' });
    }
    const msg = await createDefaultMessage({ title: title.trim(), body: body.trim(), sortOrder });
    res.status(201).json({ success: true, message: msg });
  } catch (e) { next(e); }
}

async function editDefaultMessage(req, res, next) {
  try {
    const { title, body, sortOrder } = req.body;
    const msg = await updateDefaultMessage(req.params.id, { title, body, sortOrder });
    ok(res, { message: msg });
  } catch (e) { next(e); }
}

async function removeDefaultMessage(req, res, next) {
  try {
    await deleteDefaultMessage(req.params.id);
    ok(res, { message: 'Deleted' });
  } catch (e) { next(e); }
}

async function getConversationHistory(req, res, next) {
  try {
    const { staffId, status, dateFrom, dateTo, search, page = 1, limit = 20 } = req.query;
    const result = await listConversationHistory({
      staffId, status, dateFrom, dateTo, search,
      page: parseInt(page), limit: parseInt(limit),
    });
    ok(res, result);
  } catch (e) { next(e); }
}

async function getStaffUsers(req, res, next) {
  try {
    const staff = await listStaffUsers();
    ok(res, { staff });
  } catch (e) { next(e); }
}

async function markRead(req, res, next) {
  try {
    // Staff reading -> marks customer messages read. Customer/guest reading -> marks staff messages read.
    await markMessagesRead(req.params.id, { byStaff: isStaffUser(req.user) });
    ok(res, { message: 'Marked as read' });
  } catch (e) { next(e); }
}

async function setTyping(req, res, next) {
  try {
    await recordTyping(req.params.id, { userId: req.user?.id || null, isStaff: isStaffUser(req.user) });
    ok(res, { message: 'Typing recorded' });
  } catch (e) { next(e); }
}

async function typingStatus(req, res, next) {
  try {
    const status = await getTypingStatus(req.params.id);
    ok(res, status);
  } catch (e) { next(e); }
}

module.exports = {
  getTickets, getOne, reply, setStatus, createTicket, getMyTickets, customerReply,
  getSupportSettings, updateSupportSettings,
  getDefaultMessages, addDefaultMessage, editDefaultMessage, removeDefaultMessage,
  getConversationHistory, getStaffUsers,
  markRead, setTyping, typingStatus,
};
