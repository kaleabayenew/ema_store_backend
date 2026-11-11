const admin = require('firebase-admin');
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
  // Check if admin is available (firebase-admin package)
  try {
    if (!admin || !admin.apps) {
      console.warn('[Firebase] firebase-admin package not available. Push notifications will be DISABLED.');
      return false;
    }
  } catch (e) {
    console.warn('[Firebase] Firebase not configured. Push notifications will be DISABLED.');
    return false;
  }

  if (_initialized || (admin.apps && admin.apps.length > 0)) {
    _initialized = true;
    return true;
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
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
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
 * Returns true on success, false if Firebase is not configured or send fails.
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
    const response = await admin.messaging().send(message);
    console.log(`[Firebase] Push sent ✓ messageId: ${response}`);
    return true;
  } catch (err) {
    // Token is invalid/expired — clear it from DB so we don't keep trying
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
    const response = await admin.messaging().sendEachForMulticast(message);
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
