import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/**
 * The server's own Firebase access, with the service account's full rights.
 * Browsers never talk to Firestore or Storage directly: the security rules
 * deny all client access, and every read and write goes through these.
 */
let app: App | null = null;
let firestore: Firestore | null = null;

function adminApp(): App {
  if (app) return app;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Hosting dashboards often store the key with literal "\n"s.
  const escapedNewline = String.fromCharCode(92) + 'n';
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim()
    .replace(/^"|"$/g, '') // pasted with its .env quotes
    .split(escapedNewline)
    .join(String.fromCharCode(10));
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase is not configured: set FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY and the NEXT_PUBLIC_FIREBASE_* values.');
  }
  app =
    getApps()[0] ??
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
  return app;
}

export const adminAuth = () => getAuth(adminApp());

// Documents hold JSON strings (see store-firebase.ts), so no undefined values
// ever reach Firestore and its default settings suffice.
export function db(): Firestore {
  firestore ??= getFirestore(adminApp());
  return firestore;
}

export const bucket = () => getStorage(adminApp()).bucket();
