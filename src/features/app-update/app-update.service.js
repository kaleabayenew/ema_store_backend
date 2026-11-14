const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const DATA_DIR = path.join(__dirname, '../../../data');
const ACTIVE_VERSION_FILE = path.join(DATA_DIR, 'active_app_version.json');
const PENDING_RELEASES_FILE = path.join(DATA_DIR, 'pending_releases.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const getOwnerChatId = () => {
  return process.env.TELEGRAM_OWNER_CHAT_ID || '8925980304';
};

const getBotToken = () => {
  return process.env.TELEGRAM_BOT_TOKEN;
};

// Singleton bot client for sending if not passed from server.js
let _botInstance = null;
const getBot = () => {
  if (!_botInstance && getBotToken()) {
    _botInstance = new TelegramBot(getBotToken());
  }
  return _botInstance;
};

// Read active versions from file with fallback to env
const getActiveVersionConfig = (appType = 'customer') => {
  const isCustomer = appType.toLowerCase() === 'customer';

  let saved = {};
  if (fs.existsSync(ACTIVE_VERSION_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(ACTIVE_VERSION_FILE, 'utf8'));
    } catch (_) {}
  }

  const appData = saved[appType] || {};

  return {
    latestVersion: appData.latestVersion || (isCustomer ? (process.env.CUSTOMER_APP_VERSION || '0.1.0') : (process.env.PARTNER_APP_VERSION || '1.0.0')),
    latestBuild: appData.latestBuild || parseInt(isCustomer ? (process.env.CUSTOMER_APP_BUILD || '1') : (process.env.PARTNER_APP_BUILD || '1'), 10),
    minVersion: appData.minVersion || (isCustomer ? (process.env.CUSTOMER_MIN_VERSION || '0.1.0') : (process.env.PARTNER_MIN_VERSION || '1.0.0')),
    minBuild: appData.minBuild || parseInt(isCustomer ? (process.env.CUSTOMER_MIN_BUILD || '1') : (process.env.PARTNER_MIN_BUILD || '1'), 10),
    forceUpdate: appData.forceUpdate !== undefined ? appData.forceUpdate : (isCustomer ? process.env.CUSTOMER_FORCE_UPDATE === 'true' : process.env.PARTNER_FORCE_UPDATE === 'true'),
    releaseNotes: appData.releaseNotes || (isCustomer ? (process.env.CUSTOMER_RELEASE_NOTES || 'New performance and live feature updates.') : (process.env.PARTNER_RELEASE_NOTES || 'New partner dashboard updates.')),
    apkUrl: appData.apkUrl || (isCustomer ? (process.env.CUSTOMER_APK_URL || '') : (process.env.PARTNER_APK_URL || '')),
    telegramUrl: appData.telegramUrl || (isCustomer ? (process.env.CUSTOMER_TELEGRAM_URL || '') : (process.env.PARTNER_TELEGRAM_URL || '')),
    updatedAt: appData.updatedAt || new Date().toISOString(),
  };
};

const saveActiveVersionConfig = (appType, newConfig) => {
  let saved = {};
  if (fs.existsSync(ACTIVE_VERSION_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(ACTIVE_VERSION_FILE, 'utf8'));
    } catch (_) {}
  }

  saved[appType] = {
    ...newConfig,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(ACTIVE_VERSION_FILE, JSON.stringify(saved, null, 2), 'utf8');
  return saved[appType];
};

const getPendingReleases = () => {
  if (!fs.existsSync(PENDING_RELEASES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PENDING_RELEASES_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
};

const savePendingReleases = (releases) => {
  fs.writeFileSync(PENDING_RELEASES_FILE, JSON.stringify(releases, null, 2), 'utf8');
};

/**
 * Submits a new release and sends it to the Owner on Telegram with Approve / Reject buttons.
 */
const submitReleaseForApproval = async ({
  app = 'customer',
  version,
  buildNumber = 1,
  minVersion,
  forceUpdate = false,
  releaseNotes = '',
  apkPath,
  apkUrl = '',
  telegramUrl = '',
  bot,
}) => {
  const botClient = bot || getBot();
  const ownerId = getOwnerChatId();

  if (!botClient) {
    throw new Error('Telegram bot is not configured (missing TELEGRAM_BOT_TOKEN)');
  }

  const releaseId = `rel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const appDisplayName = app.toLowerCase() === 'customer' ? 'Customer App' : 'Partner App';
  const safeApkUrl = /^https?:\/\//i.test(String(apkUrl)) ? String(apkUrl).slice(0, 500) : '';

  const pendingData = {
    releaseId,
    app: app.toLowerCase(),
    version,
    buildNumber: parseInt(buildNumber, 10) || 1,
    minVersion: minVersion || version,
    forceUpdate: forceUpdate === true || forceUpdate === 'true',
    releaseNotes,
    apkUrl: safeApkUrl,
    telegramUrl,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  const releases = getPendingReleases();
  releases[releaseId] = pendingData;
  savePendingReleases(releases);

  // apkPath must point inside the backend data directory — never let a
  // caller make the server read and send arbitrary files (e.g. .env).
  let safeApkPath = null;
  if (apkPath) {
    const resolved = path.resolve(String(apkPath));
    const allowedDir = path.resolve(DATA_DIR);
    if (resolved.startsWith(allowedDir + path.sep) && resolved.toLowerCase().endsWith('.apk') && fs.existsSync(resolved)) {
      safeApkPath = resolved;
    }
  }

  const caption = [
    `🚀 *NEW APP RELEASE READY FOR APPROVAL*`,
    ``,
    `📱 *App:* ${appDisplayName}`,
    `🏷 *Version:* v${version} (Build ${buildNumber})`,
    `⚠️ *Type:* ${pendingData.forceUpdate ? '🚨 Mandatory Force Update' : '🟢 Optional Update'}`,
    ``,
    `📝 *What's New:*`,
    releaseNotes || '• Bug fixes and speed improvements.',
    ...(safeApkUrl ? [``, `🔗 *APK URL:* ${safeApkUrl}`] : []),
    ``,
    `_Tap Approve to publish this release immediately to all app users._`,
  ].join('\n');

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '✅ Approve & Publish', callback_data: `approve_rel:${releaseId}` },
        { text: '❌ Reject & Cancel', callback_data: `reject_rel:${releaseId}` },
      ],
    ],
  };

  // If a validated APK file exists on disk, send as document with caption and buttons
  if (safeApkPath) {
    await botClient.sendDocument(ownerId, fs.createReadStream(safeApkPath), {
      caption,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup,
    });
  } else {
    // Send formatted message
    await botClient.sendMessage(ownerId, caption, {
      parse_mode: 'Markdown',
      reply_markup: replyMarkup,
    });
  }

  return { success: true, releaseId };
};

/**
 * Approves a pending release, updates active version, and notifies owner.
 */
const approveRelease = async (releaseId, bot) => {
  const releases = getPendingReleases();
  const rel = releases[releaseId];

  if (!rel) {
    return { success: false, message: 'Release not found or already processed.' };
  }

  if (rel.status !== 'PENDING') {
    return { success: false, message: `Release is already ${rel.status}.` };
  }

  // Update active version
  saveActiveVersionConfig(rel.app, {
    latestVersion: rel.version,
    latestBuild: rel.buildNumber,
    minVersion: rel.minVersion || rel.version,
    minBuild: rel.forceUpdate ? rel.buildNumber : 1,
    forceUpdate: rel.forceUpdate,
    releaseNotes: rel.releaseNotes,
    apkUrl: rel.apkUrl,
    telegramUrl: rel.telegramUrl,
  });

  rel.status = 'APPROVED';
  rel.approvedAt = new Date().toISOString();
  releases[releaseId] = rel;
  savePendingReleases(releases);

  return {
    success: true,
    release: rel,
    message: `✅ Version v${rel.version} (Build ${rel.buildNumber}) is now LIVE! All apps will prompt users to update.`,
  };
};

/**
 * Rejects a pending release.
 */
const rejectRelease = async (releaseId) => {
  const releases = getPendingReleases();
  const rel = releases[releaseId];

  if (!rel) {
    return { success: false, message: 'Release not found or already processed.' };
  }

  rel.status = 'REJECTED';
  rel.rejectedAt = new Date().toISOString();
  releases[releaseId] = rel;
  savePendingReleases(releases);

  return {
    success: true,
    release: rel,
    message: `❌ Release v${rel.version} was rejected. Nothing was published.`,
  };
};

module.exports = {
  getOwnerChatId,
  getActiveVersionConfig,
  saveActiveVersionConfig,
  submitReleaseForApproval,
  approveRelease,
  rejectRelease,
};

