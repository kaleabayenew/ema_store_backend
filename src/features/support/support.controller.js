const {
  listTickets,
  getTicket,
  addReply,
  updateStatus,
  createTicket: createTicketService,
  getCustomerTickets,
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
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ success: false, message: 'Reply body is required' });
    const msg = await addReply(req.params.id, { senderId: req.user?.id, body: body.trim(), isStaff: true });
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
    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).json({ success: false, message: 'Subject and message are required' });
    }
    const ticket = await createTicketService({
      userId: req.user?.id || null,
      subject: subject.trim(),
      initialMessage: message.trim(),
      priority,
    });
    res.status(201).json({ success: true, ticket });
  } catch (e) { next(e); }
}

async function getMyTickets(req, res, next) {
  try {
    const tickets = await getCustomerTickets(req.user.id);
    ok(res, { tickets });
  } catch (e) { next(e); }
}

async function customerReply(req, res, next) {
  try {
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ success: false, message: 'Reply body is required' });
    const msg = await addReply(req.params.id, { senderId: req.user?.id || null, body: body.trim(), isStaff: false });
    ok(res, { message: msg });
  } catch (e) { next(e); }
}

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
    // Admin (staff) marks customer messages as read by default
    const byStaff = req.body?.byStaff ?? true;
    await markMessagesRead(req.params.id, { byStaff });
    ok(res, { message: 'Marked as read' });
  } catch (e) { next(e); }
}

async function setTyping(req, res, next) {
  try {
    const isStaff = req.body?.isStaff ?? true;
    await recordTyping(req.params.id, { userId: req.user?.id, isStaff });
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
