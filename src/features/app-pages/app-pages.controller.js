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

module.exports = { listPages, updatePage, getState };
