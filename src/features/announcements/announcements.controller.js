const svc = require('./announcements.service');
const { ok, created } = require('../../core/utils/response');

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

const badId = (res) => {
  const { error } = require('../../core/utils/response');
  return error(res, 'Invalid announcement id.', 400, 'INVALID_ID');
};

async function list(req, res, next) {
  try {
    const data = await svc.listAnnouncements({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
    });
    ok(res, data);
  } catch (err) { next(err); }
}

async function getOne(req, res, next) {
  try {
    if (!UUID_RE.test(req.params.id)) return badId(res);
    ok(res, { announcement: await svc.getAnnouncement(req.params.id) });
  } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const ann = await svc.createAnnouncement({
      title: req.body?.title,
      body: req.body?.body,
      audience: req.body?.audience,
      action: req.body?.action,
      scheduledAt: req.body?.scheduledAt,
      createdBy: req.user?.id,
    });
    // 'send' action dispatches inside the service and returns the SENT row.
    if (ann.status === 'SENT') ok(res, { announcement: ann });
    else created(res, { announcement: ann });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    if (!UUID_RE.test(req.params.id)) return badId(res);
    const ann = await svc.updateAnnouncement(req.params.id, {
      title: req.body?.title,
      body: req.body?.body,
      audience: req.body?.audience,
      action: req.body?.action,
      scheduledAt: req.body?.scheduledAt,
    });
    ok(res, { announcement: ann });
  } catch (err) { next(err); }
}

async function remove(req, res, next) {
  try {
    if (!UUID_RE.test(req.params.id)) return badId(res);
    await svc.deleteAnnouncement(req.params.id);
    ok(res, { message: 'Announcement deleted.' });
  } catch (err) { next(err); }
}

async function publish(req, res, next) {
  try {
    if (!UUID_RE.test(req.params.id)) return badId(res);
    ok(res, { announcement: await svc.dispatchAnnouncement(req.params.id) });
  } catch (err) { next(err); }
}

module.exports = { list, getOne, create, update, remove, publish };
