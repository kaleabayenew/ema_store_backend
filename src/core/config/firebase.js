const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const path  = require('path');
const fs    = require('fs');

// ─────────────────────────────────────────────────────────────────────────────
//  Firebase Admin SDK initializer
//  Looks for the service account key in:
//    1. FIREBASE_SERVICE_ACCOUNT_PATH env var (absolute or relative to project root)
//    2. Default path: <backend root>/firebase-service-account.json
// ─────────────────────────────────────────────────────────────────────────────

let _initialized = false;

function initFirebase() {
  if (_initialized || getApps().length > 0) {
    _initialized = true;
    return true;
  }

  // Preferred on hosted platforms (Render etc.): the whole service-account
  // JSON pasted into an env var — the .json file is gitignored and never
  // reaches the deploy.
  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (envJson && envJson.trim().startsWith('{')) {
    try {
      const serviceAccount = JSON.parse(envJson);
      initializeApp({ credential: cert(serviceAccount) });
      console.log(`[Firebase] Admin SDK initialized ✓ via env var (project: ${serviceAccount.project_id})`);
      _initialized = true;
      return true;
    } catch (err) {
      console.error('[Firebase] FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON:', err.message);
      return false;
    }
  }

  // Resolve service account file path
  const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const defaultPath = path.resolve(__dirname, '../../../firebase-service-account.json');
  const serviceAccountPath = envPath
    ? path.resolve(__dirname, '../../../', envPath)
    : defaultPath;

  if (!fs.existsSync(serviceAccountPath)) {
    console.warn(
      `[Firebase] Service account key not found at: ${serviceAccountPath}\n` +
      `[Firebase] Push notifications will be DISABLED.\n` +
      `[Firebase] To enable: download the key from Firebase Console → Project Settings → Service accounts\n` +
      `[Firebase] and save it as: firebase-service-account.json in the backend root.`,
    );
    return false;
  }

  try {
    const serviceAccount = require(serviceAccountPath);
    initializeApp({
      credential: cert(serviceAccount),
    });
    console.log(`[Firebase] Admin SDK initialized ✓ (project: ${serviceAccount.project_id})`);
    _initialized = true;
    return true;
  } catch (err) {
    console.error('[Firebase] Failed to initialize Admin SDK:', err.message);
    return false;
  }
}

/**
 * Send a push notification to a single FCM token.
 * Returns true on success, 'INVALID_TOKEN' for dead tokens, false otherwise.
 *
 * @param {string} token - FCM device token
 * @param {{ title: string, body: string }} notification
 * @param {Record<string, string>} [data] - optional key-value data payload
 */
async function sendPush(token, notification, data = {}) {
  if (!token) return false;

  if (!_initialized && !initFirebase()) {
    console.log(`[Firebase] Push skipped (not configured): ${notification.title}`);
    return false;
  }

  // FCM data values must all be strings
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)]),
  );

  const message = {
    token,
    notification: {
      title: notification.title,
      body:  notification.body,
    },
    data: stringData,
    android: {
      priority: 'high',
      notification: {
        sound:       'default',
        channelId:   data.channelId || 'eco_orders',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        },
      },
    },
  };

  try {
    const response = await getMessaging().send(message);
    console.log(`[Firebase] Push sent ✓ messageId: ${response}`);
    return true;
  } catch (err) {
    // Token is invalid/expired — caller can clear it from DB
    if (
      err.code === 'messaging/invalid-registration-token' ||
      err.code === 'messaging/registration-token-not-registered'
    ) {
      console.warn(`[Firebase] Invalid FCM token — will be cleared: ${token.slice(0, 20)}...`);
      return 'INVALID_TOKEN';
    }
    console.error('[Firebase] Push send failed:', err.message);
    return false;
  }
}

/**
 * Send a push notification to multiple FCM tokens (multicast).
 * Returns { successCount, failureCount }
 */
async function sendMulticastPush(tokens, notification, data = {}) {
  const validTokens = tokens.filter(Boolean);
  if (validTokens.length === 0) return { successCount: 0, failureCount: 0 };

  if (!_initialized && !initFirebase()) {
    console.log(`[Firebase] Multicast push skipped (not configured): ${notification.title}`);
    return { successCount: 0, failureCount: validTokens.length };
  }

  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)]),
  );

  const message = {
    tokens: validTokens,
    notification: {
      title: notification.title,
      body:  notification.body,
    },
    data: stringData,
    android: {
      priority: 'high',
      notification: {
        sound:     'default',
        channelId: data.channelId || 'eco_orders',
      },
    },
    apns: {
      payload: { aps: { sound: 'default', badge: 1 } },
    },
  };

  try {
    const response = await getMessaging().sendEachForMulticast(message);
    console.log(`[Firebase] Multicast: ${response.successCount} sent, ${response.failureCount} failed`);
    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  } catch (err) {
    console.error('[Firebase] Multicast push failed:', err.message);
    return { successCount: 0, failureCount: validTokens.length };
  }
}

module.exports = { initFirebase, sendPush, sendMulticastPush };
