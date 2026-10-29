require('dotenv').config();
const admin = require('firebase-admin');

let firebaseInitialized = false;

function initFirebase() {
  if (firebaseInitialized) {
    console.log('[Firebase] Already initialized');
    return;
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (!serviceAccountPath) {
    console.warn('[Firebase] FIREBASE_SERVICE_ACCOUNT_PATH not set, skipping initialization');
    return;
  }

  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
    console.log('[Firebase] Initialized successfully');
  } catch (error) {
    console.error('[Firebase] Initialization failed:', error.message);
    throw error;
  }
}

module.exports = {
  initFirebase,
};