const { listTickets, getTicket, addReply, updateStatus, createTicket: createTicketService, getCustomerTickets } = require('./support.service');
const { ok } = require('../../core/utils/response');

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
      userId: req.user.id,
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
    const msg = await addReply(req.params.id, { senderId: req.user?.id, body: body.trim(), isStaff: false });
    ok(res, { message: msg });
  } catch (e) { next(e); }
}

module.exports = { getTickets, getOne, reply, setStatus, createTicket, getMyTickets, customerReply };
