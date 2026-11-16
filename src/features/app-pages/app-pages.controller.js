const svc = require('./app-pages.service');
const { ok } = require('../../core/utils/response');

async function listPages(req, res, next) {
  try {
    const pages = await svc.listPages(req.params.app);
    ok(res, { app: req.params.app, pages, count: pages.length });
  } catch (e) { next(e); }
}

async function updatePage(req, res, next) {
  try {
    const page = await svc.setPageControl(req.params.app, req.params.pageKey, {
      isHidden: req.body?.isHidden,
      isLocked: req.body?.isLocked,
    });
    ok(res, { page });
  } catch (e) { next(e); }
}

async function getState(req, res, next) {
  try {
    const state = await svc.getState(req.query.app || 'customer');
    ok(res, state);
  } catch (e) { next(e); }
}

async function getMaintenance(req, res, next) {
  try {
    const maintenance = await svc.getMaintenance(req.params.app);
    ok(res, { app: req.params.app, maintenance });
  } catch (e) { next(e); }
}

async function setMaintenance(req, res, next) {
  try {
    const maintenance = await svc.setMaintenance(req.params.app, {
      enabled: req.body?.enabled,
      message: req.body?.message,
    });
    ok(res, { app: req.params.app, maintenance });
  } catch (e) { next(e); }
}

module.exports = { listPages, updatePage, getState, getMaintenance, setMaintenance };
