'use client';

import { getApps, initializeApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

/** Browser-side Firebase, used only to sign in; data goes through the server. */
export function clientAuth(): Auth {
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  return getAuth(app);
}

/** Ends the session on the server and in the browser, then goes to the login page. */
export async function signOutEverywhere() {
  await fetch('/api/session', { method: 'DELETE' }).catch(() => undefined);
  await clientAuth()
    .signOut()
    .catch(() => undefined);
  // A full load, not client navigation: the next page must render signed out.
  window.location.assign(new URL('/login', window.location.origin).href);
}
