const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('../../core/config/database');

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

// Active version config — Postgres is the source of truth so approvals are
// shared across environments (Render's filesystem is ephemeral). The local
// JSON file is kept only as a fallback/cache.
const getActiveVersionConfig = async (appType = 'customer') => {
  const isCustomer = appType.toLowerCase() === 'customer';
  const key = appType.toLowerCase();

  try {
    const r = await pool.query(`SELECT * FROM app_version_config WHERE app_type = $1`, [key]);
    if (r.rows.length) {
      const d = r.rows[0];
      return {
        latestVersion: d.latest_version,
        latestBuild: parseInt(d.latest_build, 10) || 1,
        minVersion: d.min_version || d.latest_version,
        minBuild: parseInt(d.min_build, 10) || 1,
        forceUpdate: d.force_update === true || d.force_update === 't',
        releaseNotes: d.release_notes || '',
        apkUrl: d.apk_url || '',
        telegramUrl: d.telegram_url || '',
        updatedAt: d.updated_at,
      };
    }
  } catch (_) {}

  let saved = {};
  if (fs.existsSync(ACTIVE_VERSION_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(ACTIVE_VERSION_FILE, 'utf8'));
    } catch (_) { }
  }

  const appData = saved[key] || {};

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

const saveActiveVersionConfig = async (appType, newConfig) => {
  const key = appType.toLowerCase();

  try {
    await pool.query(
      `INSERT INTO app_version_config
         (app_type, latest_version, latest_build, min_version, min_build,
          force_update, release_notes, apk_url, telegram_url, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (app_type) DO UPDATE SET
         latest_version = EXCLUDED.latest_version,
         latest_build   = EXCLUDED.latest_build,
         min_version    = EXCLUDED.min_version,
         min_build      = EXCLUDED.min_build,
         force_update   = EXCLUDED.force_update,
         release_notes  = EXCLUDED.release_notes,
         apk_url        = EXCLUDED.apk_url,
         telegram_url   = EXCLUDED.telegram_url,
         updated_at     = NOW()`,
      [
        key,
        newConfig.latestVersion,
        newConfig.latestBuild ?? 1,
        newConfig.minVersion ?? null,
        newConfig.minBuild ?? 1,
        newConfig.forceUpdate === true,
        newConfig.releaseNotes ?? '',
        newConfig.apkUrl ?? '',
        newConfig.telegramUrl ?? '',
      ]
    );
  } catch (e) {
    console.warn('[app-update] DB save failed, falling back to file:', e.message);
  }

  let saved = {};
  if (fs.existsSync(ACTIVE_VERSION_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(ACTIVE_VERSION_FILE, 'utf8'));
    } catch (_) { }
  }

  saved[key] = {
    ...newConfig,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(ACTIVE_VERSION_FILE, JSON.stringify(saved, null, 2), 'utf8');
  return saved[key];
};

// Pending releases live in Postgres so the Telegram approve button works no
// matter which backend instance receives the callback.
const getPendingReleases = async () => {
  try {
    const r = await pool.query(`SELECT * FROM app_pending_releases`);
    const map = {};
    for (const row of r.rows) {
      map[row.release_id] = {
        releaseId: row.release_id,
        app: row.app,
        version: row.version,
        buildNumber: row.build_number,
        minVersion: row.min_version,
        forceUpdate: row.force_update === true || row.force_update === 't',
        releaseNotes: row.release_notes,
        apkUrl: row.apk_url,
        telegramUrl: row.telegram_url,
        apkPath: row.apk_path || null,
        telegramFileId: row.telegram_file_id || null,
        status: row.status,
        createdAt: row.created_at,
        approvedAt: row.approved_at,
        rejectedAt: row.rejected_at,
      };
    }
    return map;
  } catch (_) {}

  if (!fs.existsSync(PENDING_RELEASES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PENDING_RELEASES_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
};

const savePendingReleases = async (releases) => {
  try {
    for (const rel of Object.values(releases)) {
      const id = rel.releaseId;
      if (!id) continue;
      await pool.query(
        `INSERT INTO app_pending_releases
           (release_id, app, version, build_number, min_version, force_update,
            release_notes, apk_url, telegram_url, apk_path, telegram_file_id,
            status, created_at, approved_at, rejected_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (release_id) DO UPDATE SET
           status           = EXCLUDED.status,
           apk_url          = EXCLUDED.apk_url,
           telegram_file_id = EXCLUDED.telegram_file_id,
           approved_at      = EXCLUDED.approved_at,
           rejected_at      = EXCLUDED.rejected_at`,
        [
          id,
          rel.app,
          rel.version,
          rel.buildNumber ?? 1,
          rel.minVersion ?? null,
          rel.forceUpdate === true,
          rel.releaseNotes ?? '',
          rel.apkUrl ?? '',
          rel.telegramUrl ?? '',
          rel.apkPath ?? null,
          rel.telegramFileId ?? null,
          rel.status ?? 'PENDING',
          rel.createdAt ?? new Date().toISOString(),
          rel.approvedAt ?? null,
          rel.rejectedAt ?? null,
        ]
      );
    }
  } catch (e) {
    console.warn('[app-update] DB pending-release save failed:', e.message);
  }

  try {
    fs.writeFileSync(PENDING_RELEASES_FILE, JSON.stringify(releases, null, 2), 'utf8');
  } catch (_) {}
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

  // apkPath is validated against allowed directories:
  //   1. backend/data/   (server-managed uploads)
  //   2. customer/build/ (Flutter release APK output)
  //   3. partner/build/  (Flutter release APK output)
  // This prevents the caller from making the server send arbitrary files (e.g. .env).
  let safeApkPath = null;
  if (apkPath) {
    const resolved = path.resolve(String(apkPath));
    const allowedDirs = [
      path.resolve(DATA_DIR),
      path.resolve(path.join(__dirname, '../../../../customer/build')),
      path.resolve(path.join(__dirname, '../../../../partner/build')),
    ];
    const isAllowed = allowedDirs.some(dir => resolved.startsWith(dir + path.sep) || resolved.startsWith(dir + '/'));
    if (isAllowed && resolved.toLowerCase().endsWith('.apk') && fs.existsSync(resolved)) {
      safeApkPath = resolved;
    }
  }

  const pendingData = {
    releaseId,
    app: app.toLowerCase(),
    version,
    buildNumber: parseInt(buildNumber, 10) || 1,
    minVersion: minVersion || version,
    forceUpdate: forceUpdate === true || forceUpdate === 'true',
    releaseNotes,
    apkUrl: safeApkUrl,
    apkPath: safeApkPath || null,
    telegramUrl,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  const releases = await getPendingReleases();
  releases[releaseId] = pendingData;
  await savePendingReleases(releases);

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

  // Telegram Bot API caps document uploads at 50 MB — larger APKs must go
  // through apkUrl instead of sendDocument.
  const TELEGRAM_FILE_LIMIT = 45 * 1024 * 1024;
  let apkTooLarge = false;
  if (safeApkPath) {
    try {
      apkTooLarge = fs.statSync(safeApkPath).size > TELEGRAM_FILE_LIMIT;
    } catch (_) {
      apkTooLarge = true;
    }
  }

  const finalCaption = apkTooLarge && !safeApkUrl
    ? `${caption}\n\n⚠️ _APK is over Telegram's 50 MB limit and was not attached. Re-run with --apk-url <link> so users can download it._`
    : caption;

  // If a validated APK file exists on disk and fits, send as document with
  // caption and buttons; otherwise send the formatted message.
  let sentMsg = null;
  if (safeApkPath && !apkTooLarge) {
    try {
      sentMsg = await botClient.sendDocument(ownerId, fs.createReadStream(safeApkPath), {
        caption: finalCaption,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup,
      });
    } catch (docErr) {
      // e.g. ETELEGRAM 413 — fall back to the text message so approval still works.
      console.warn('[app-update] APK document send failed, falling back to message:', docErr.message);
      sentMsg = await botClient.sendMessage(ownerId, finalCaption, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup,
      });
    }
  } else {
    // Send formatted message
    sentMsg = await botClient.sendMessage(ownerId, finalCaption, {
      parse_mode: 'Markdown',
      reply_markup: replyMarkup,
    });
  }

  // Save the telegram file_id if document was uploaded so user broadcasts are instantaneous
  if (sentMsg?.document?.file_id) {
    pendingData.telegramFileId = sentMsg.document.file_id;
    releases[releaseId] = pendingData;
    await savePendingReleases(releases);
  }

  return { success: true, releaseId };
};

/**
 * Approves a pending release, updates active version, and notifies owner.
 */
const approveRelease = async (releaseId, bot) => {
  const releases = await getPendingReleases();
  const rel = releases[releaseId];

  // If already approved in active version or in pending releases
  if (rel && rel.status === 'APPROVED') {
    return {
      success: true,
      alreadyApproved: true,
      release: rel,
      message: `✅ Version v${rel.version} (Build ${rel.buildNumber}) is ALREADY approved and live!`,
    };
  }

  if (!rel) {
    // Check if the current active version matches
    const activeCustomer = await getActiveVersionConfig('customer');
    return {
      success: true,
      alreadyApproved: true,
      release: { app: 'customer', version: activeCustomer.latestVersion, buildNumber: activeCustomer.latestBuild, forceUpdate: activeCustomer.forceUpdate },
      message: `✅ Version v${activeCustomer.latestVersion} is ALREADY approved and live!`,
    };
  }

  if (rel.status !== 'PENDING') {
    return { success: false, message: `Release is already ${rel.status}.` };
  }

  // Update active version
  await saveActiveVersionConfig(rel.app, {
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
  await savePendingReleases(releases);

  // Automatically broadcast APK & release announcement to all users who started the bot
  broadcastReleaseToUsers(rel, bot).catch(err => {
    console.error('[app-update] Broadcast error:', err.message);
  });

  return {
    success: true,
    release: rel,
    message: `✅ Version v${rel.version} (Build ${rel.buildNumber}) is now LIVE! Broadcast is sending to all bot users.`,
  };
};

const SUBSCRIBERS_FILE = path.join(DATA_DIR, 'bot_subscribers.json');

/**
 * Records any user who starts or interacts with the bot so they receive update broadcasts.
 */
const recordSubscriber = (chatId, username) => {
  if (!chatId) return;
  try {
    let subs = {};
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      subs = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8'));
    }
    subs[String(chatId)] = {
      chatId: String(chatId),
      username: username || null,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subs, null, 2), 'utf8');
  } catch (_) {}
};

/**
 * Broadcasts the approved APK and release notes to all users who started the bot.
 */
const broadcastReleaseToUsers = async (rel, botInstance) => {
  const botClient = botInstance || getBot();
  if (!botClient) return { sentCount: 0, failedCount: 0 };

  const ownerId = String(getOwnerChatId());
  const recipientIds = new Set();

  // 1. From database table telegram_chat_ids
  try {
    const { pool } = require('../../core/config/database');
    const { rows } = await pool.query('SELECT DISTINCT chat_id FROM telegram_chat_ids WHERE chat_id IS NOT NULL');
    for (const r of rows) {
      if (r.chat_id) recipientIds.add(String(r.chat_id));
    }
  } catch (err) {
    console.warn('[app-update] Failed to fetch db telegram chat IDs:', err.message);
  }

  // 2. From bot subscribers file (everyone who ran /start or messaged the bot)
  try {
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      const subs = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8'));
      for (const id of Object.keys(subs)) {
        if (id) recipientIds.add(String(id));
      }
    }
  } catch (_) {}

  if (recipientIds.size === 0) {
    console.log('[app-update] No users to broadcast to yet.');
    try {
      await botClient.sendMessage(
        ownerId,
        `ℹ️ Release v${rel.version} is now LIVE, but no subscribed bot users were found to broadcast to.`,
        { parse_mode: 'Markdown' }
      );
    } catch (_) {}
    return { sentCount: 0, failedCount: 0 };
  }

  console.log(`[app-update] Broadcasting release v${rel.version} to ${recipientIds.size} users...`);

  // Locate the APK file
  const appDisplayName = rel.app.toLowerCase() === 'customer' ? 'Customer App' : 'Partner App';
  let apkPath = rel.apkPath;
  if (!apkPath || !fs.existsSync(apkPath)) {
    const defaultArm64 = path.resolve(path.join(__dirname, `../../../../${rel.app}/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk`));
    const defaultFat = path.resolve(path.join(__dirname, `../../../../${rel.app}/build/app/outputs/flutter-apk/app-release.apk`));
    if (fs.existsSync(defaultArm64)) apkPath = defaultArm64;
    else if (fs.existsSync(defaultFat)) apkPath = defaultFat;
  }

  const hasApkFile = apkPath && fs.existsSync(apkPath) && fs.statSync(apkPath).size <= 49 * 1024 * 1024;
  let cachedFileId = rel.telegramFileId || null;

  const caption = [
    `🎉 *NEW UPDATE AVAILABLE!*`,
    ``,
    `📱 *Ema Store ${appDisplayName}*`,
    `🏷 *Version:* v${rel.version} (Build ${rel.buildNumber})`,
    `⚠️ *Type:* ${rel.forceUpdate ? '🚨 Mandatory Update' : '🟢 Recommended Update'}`,
    ``,
    `📝 *What's New:*`,
    rel.releaseNotes || '• New performance improvements and live updates.',
    ``,
    (hasApkFile || cachedFileId)
      ? `⬇️ *Download the APK file attached to this message and tap it to install.*`
      : (rel.apkUrl ? `⬇️ *Tap below to download the latest version:*` : ''),
  ].filter(Boolean).join('\n');

  const replyMarkup = rel.apkUrl ? {
    inline_keyboard: [
      [{ text: '⬇️ Download APK Directly', url: rel.apkUrl }]
    ]
  } : undefined;

  let sentCount = 0;
  let failedCount = 0;

  for (const chatId of recipientIds) {
    try {
      if (cachedFileId) {
        // Fast instant delivery via Telegram server cache
        await botClient.sendDocument(chatId, cachedFileId, {
          caption,
          parse_mode: 'Markdown',
          reply_markup: replyMarkup,
        });
      } else if (hasApkFile) {
        const sent = await botClient.sendDocument(chatId, fs.createReadStream(apkPath), {
          caption,
          parse_mode: 'Markdown',
          reply_markup: replyMarkup,
        });
        if (sent?.document?.file_id && !cachedFileId) {
          cachedFileId = sent.document.file_id;
        }
      } else {
        await botClient.sendMessage(chatId, caption, {
          parse_mode: 'Markdown',
          reply_markup: replyMarkup,
        });
      }
      sentCount++;
    } catch (err) {
      failedCount++;
      console.warn(`[app-update] Failed to send update to chat ${chatId}:`, err.message);
    }
    // Small delay between sends to respect Telegram rate limits
    await new Promise(r => setTimeout(r, 60));
  }

  console.log(`[app-update] Broadcast complete: ${sentCount} sent, ${failedCount} failed.`);

  // Send summary confirmation to the owner
  try {
    await botClient.sendMessage(
      ownerId,
      `📢 *Broadcast Completed!*\n\nSuccessfully sent APK release v${rel.version} (Build ${rel.buildNumber}) to *${sentCount}* user(s).${failedCount > 0 ? `\n⚠️ Failed for ${failedCount} user(s).` : ''}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.warn('[app-update] Failed to notify owner of broadcast result:', err.message);
  }

  return { sentCount, failedCount };
};

/**
 * Rejects a pending release.
 */
const rejectRelease = async (releaseId) => {
  const releases = await getPendingReleases();
  const rel = releases[releaseId];

  if (!rel) {
    return { success: false, message: 'Release not found or already processed.' };
  }

  rel.status = 'REJECTED';
  rel.rejectedAt = new Date().toISOString();
  releases[releaseId] = rel;
  await savePendingReleases(releases);

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
  recordSubscriber,
  broadcastReleaseToUsers,
};

