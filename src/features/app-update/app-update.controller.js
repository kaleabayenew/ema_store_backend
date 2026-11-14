const { ok, error } = require('../../core/utils/response');
const {
  getActiveVersionConfig,
  submitReleaseForApproval,
} = require('./app-update.service');

/**
 * GET /api/v1/app-update
 * Public endpoint queried by Flutter apps on launch.
 */
const getAppVersion = async (req, res, next) => {
  try {
    const appType = (req.query.app || 'customer').toLowerCase();
    const platform = (req.query.platform || 'android').toLowerCase();

    const activeConfig = getActiveVersionConfig(appType);

    const telegramChannel = process.env.TELEGRAM_CHANNEL_URL || 'https://t.me/emastore_official';
    const telegramBot = process.env.TELEGRAM_BOT_USERNAME
      ? `https://t.me/${process.env.TELEGRAM_BOT_USERNAME.replace('@', '')}`
      : 'https://t.me/emastore_bot';

    ok(res, {
      app: appType,
      platform,
      latestVersion: activeConfig.latestVersion,
      latestBuild: activeConfig.latestBuild,
      minVersion: activeConfig.minVersion,
      minBuild: activeConfig.minBuild,
      forceUpdate: activeConfig.forceUpdate,
      title: activeConfig.forceUpdate ? 'Mandatory Update Required' : 'Update Available',
      releaseNotes: activeConfig.releaseNotes,
      apkUrl: activeConfig.apkUrl,
      telegramUrl: activeConfig.telegramUrl || telegramChannel,
      telegramBotUrl: telegramBot,
      telegramChannelUrl: telegramChannel,
      updatedAt: activeConfig.updatedAt,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/app-update/submit
 * Triggers a new release notification to Owner on Telegram with Approve/Reject buttons.
 */
const submitRelease = async (req, res, next) => {
  try {
    const {
      app = 'customer',
      version,
      buildNumber = 1,
      minVersion,
      forceUpdate = false,
      releaseNotes = '',
      apkPath,
      apkUrl = '',
      telegramUrl = '',
    } = req.body;

    if (!version) {
      return error(res, 'Version is required (e.g. "0.1.2")', 400);
    }

    const result = await submitReleaseForApproval({
      app,
      version,
      buildNumber,
      minVersion,
      forceUpdate,
      releaseNotes,
      apkPath,
      apkUrl,
      telegramUrl,
    });

    ok(res, {
      message: 'Release submitted to Owner on Telegram for approval.',
      releaseId: result.releaseId,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAppVersion,
  submitRelease,
};
