const svc = require('./contact.service');

// GET /api/v1/contact — public contact channels for the apps
async function getContact(_req, res, next) {
  try {
    const settings = await svc.getContactSettings();
    res.json({ success: true, data: settings });
  } catch (e) {
    next(e);
  }
}

// GET /api/v1/contact/admin — same payload for the admin form
async function getAdminContact(_req, res, next) {
  try {
    const settings = await svc.getContactSettings();
    res.json({ success: true, data: settings });
  } catch (e) {
    next(e);
  }
}

// PUT /api/v1/contact/admin — update contact channels
async function updateAdminContact(req, res, next) {
  try {
    const settings = await svc.updateContactSettings(req.body || {});
    res.json({ success: true, data: settings });
  } catch (e) {
    next(e);
  }
}

module.exports = { getContact, getAdminContact, updateAdminContact };
