import { cookies } from 'next/headers';
import { handleRouteError, jsonError } from '@/lib/api';
import { SESSION_COOKIE, storageMode } from '@/lib/backend';
import { adminAuth } from '@/lib/firebase-admin';
import { SESSION_DAYS, emailAllowed } from '@/lib/session';

/**
 * Sign-in: the browser signs in with Firebase Auth and hands over the ID token;
 * the server checks it (and the invite list) and sets its own HTTP-only
 * session cookie, which every later request is verified against.
 */
export async function POST(request: Request) {
  try {
    if (storageMode() !== 'firebase') return jsonError('Sign-in is not used on this install.', 404);
    const { idToken } = (await request.json()) as { idToken?: string };
    if (!idToken) return jsonError('Missing sign-in token.');

    // Only fresh sign-ins become sessions: a stolen old token cannot be replayed.
    const decoded = await adminAuth().verifyIdToken(idToken, true);
    if (Date.now() / 1000 - decoded.auth_time > 5 * 60) return jsonError('Sign in again.', 401);
    if (!emailAllowed(decoded.email)) {
      return jsonError('This beta is invite-only, and that email is not on the list. Ask for an invite.', 403);
    }

    const expiresIn = SESSION_DAYS * 24 * 60 * 60 * 1000;
    const session = await adminAuth().createSessionCookie(idToken, { expiresIn });
    (await cookies()).set(SESSION_COOKIE, session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: expiresIn / 1000,
    });
    return Response.json({ ok: true, email: decoded.email ?? null });
  } catch (err) {
    if ((err as { code?: string }).code?.startsWith('auth/')) return jsonError('That sign-in could not be verified. Try again.', 401);
    return handleRouteError(err);
  }
}

/** Sign-out. */
export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
