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
  deleteTicket,
  getPreviousTicketsForCustomer,
} = require('./support.service');
const { ok } = require('../../core/utils/response');
const { saveChatImage } = require('../../core/config/storage');
const { uploadChatImage } = require('./support.upload');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Staff = any logged-in user whose role is not CUSTOMER / PARTNER. */
function isStaffUser(user) {
  if (!user) return false;
  const role = String(user.adminRole || user.role || '').toUpperCase();
  const staffRoles = [
    'ADMIN',
    'SUPER_ADMIN',
    'CUSTOMER_SUPPORT',
    'MANAGER',
    'MANAGEMENT',
    'PARTNER_MANAGER',
    'PRODUCT_MANAGER',
    'FINANCE',
    'MARKETING',
  ];
  return staffRoles.includes(role) || (role !== '' && role !== 'CUSTOMER' && role !== 'PARTNER');
}

/** Stable guest identity sent by the app (device id). Body, query or header. */
function getGuestId(req) {
  const raw = req?.body?.guestId || req?.query?.guestId || req?.headers?.['x-guest-id'] || req?.headers?.['x-device-id'];
  const id = typeof raw === 'string' ? raw.trim() : '';
  return id ? id.slice(0, 100) : null; // column is VARCHAR(100)
}

// ── Tickets ───────────────────────────────────────────────────────────────────

async function getTickets(req, res, next) {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const user = req.user;
    const isAdmin = user && (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN');
    const result = await listTickets({ 
      status, 
      search, 
      page: parseInt(page), 
      limit: parseInt(limit),
      userId: user?.id,
      isAdmin 
    });
    ok(res, result);
  } catch (e) { next(e); }
}

async function getOne(req, res, next) {
  try {
    const ticket = await getTicket(req.params.id);

    // Get previous tickets for the same customer (for context)
    const userId = req.user?.id || null;
    const guestId = getGuestId(req);
    const previousTickets = await getPreviousTicketsForCustomer(userId, guestId, ticket.id);

    // Return both nested ticket (for web & detailed views) and flattened ticket (for flutter clients expecting messages at root)
    ok(res, {
      ...ticket,
      ticket,
      previousTickets,
    });
  } catch (e) { next(e); }
}

async function reply(req, res, next) {
  try {
    const body = req.body?.body;
    const imageUrl = req.body?.imageUrl;
    if (!body?.trim() && !imageUrl) {
      return res.status(400).json({ success: false, message: 'Reply body or image is required' });
    }

    // Debug logging
    console.log('📝 Reply attempt:', {
      user: req.user,
      userRole: req.user?.role,
      isStaff: isStaffUser(req.user),
      hasAuth: !!req.headers.authorization,
    });

    // A token was sent but not understood: do not silently treat an admin as a guest.
    if (req.headers.authorization && !req.user) {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }

    const staff = isStaffUser(req.user);
    const guestId = staff ? null : getGuestId(req);
    if (!staff && !req.user?.id && !guestId) {
      return res.status(400).json({ success: false, message: 'guestId is required for guest replies' });
    }

    const msg = await addReply(req.params.id, {
      senderId: req.user?.id || null,
      guestId,
      body: body?.trim() || null,
      imageUrl: imageUrl || null,
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
    const staff = isStaffUser(req.user);
    const guestId = getGuestId(req);
    // Staff reading -> marks customer messages read. Customer/guest reading -> marks staff messages read.
    await markMessagesRead(req.params.id, { byStaff: staff, userId: req.user?.id, guestId });
    ok(res, { message: 'Marked as read' });
  } catch (e) { next(e); }
}

async function setTyping(req, res, next) {
  try {
    const staff = isStaffUser(req.user);
    const guestId = getGuestId(req);
    // Staff can type on any ticket, customers only on their own
    await recordTyping(req.params.id, { isStaff: staff, userId: req.user?.id, guestId });
    ok(res, { message: 'Typing recorded' });
  } catch (e) { next(e); }
}

async function typingStatus(req, res, next) {
  try {
    const status = await getTypingStatus(req.params.id);
    ok(res, status);
  } catch (e) { next(e); }
}

async function deleteTicketController(req, res, next) {
  try {
    await deleteTicket(req.params.id);
    ok(res, { message: 'Ticket deleted' });
  } catch (e) { next(e); }
}

async function uploadChatImageController(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // Generate a temporary message ID for the image key
    const tempMessageId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Upload to Neon Object Storage
    const imageUrl = await saveChatImage(req.file.buffer, tempMessageId, req.file.mimetype);

    res.status(201).json({ success: true, imageUrl, tempMessageId });
  } catch (e) { next(e); }
}

module.exports = {
  getTickets, getOne, reply, setStatus, createTicket, getMyTickets, customerReply,
  getSupportSettings, updateSupportSettings,
  getDefaultMessages, addDefaultMessage, editDefaultMessage, removeDefaultMessage,
  getConversationHistory, getStaffUsers,
  markRead, setTyping, typingStatus,
  deleteTicket: deleteTicketController,
  uploadChatImage: uploadChatImageController,
};
