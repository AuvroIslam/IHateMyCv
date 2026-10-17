import { cookies } from 'next/headers';
import { SESSION_COOKIE } from './backend';
import { adminAuth } from './firebase-admin';

export interface SessionUser {
  uid: string;
  email?: string;
  name?: string;
}

/** How long a sign-in lasts: Firebase allows at most two weeks. */
export const SESSION_DAYS = 14;

/** The signed-in user of this request, or null. Verifies the session cookie's signature and expiry. */
export async function currentUser(): Promise<SessionUser | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const t = await adminAuth().verifySessionCookie(cookie);
    return { uid: t.uid, email: t.email, name: t.name as string | undefined };
  } catch {
    return null; // expired, revoked or forged: treated as signed out
  }
}

/**
 * Who may sign in. ALLOWED_EMAILS (comma-separated) keeps a beta to invited
 * friends; unset, anyone may.
 */
export function emailAllowed(email: string | undefined): boolean {
  const list = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return true;
  return Boolean(email && list.includes(email.toLowerCase()));
}
