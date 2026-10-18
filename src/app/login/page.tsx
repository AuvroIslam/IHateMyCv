'use client';

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  type UserCredential,
} from 'firebase/auth';
import { useState } from 'react';
import { Button, ErrorNote, Input, Panel, Spinner } from '@/components/ui/kit';
import { clientAuth } from '@/lib/firebase-client';

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'That email and password do not match an account.',
  'auth/invalid-email': 'That email address does not look right.',
  'auth/email-already-in-use': 'An account with that email already exists. Sign in instead.',
  'auth/weak-password': 'Use a password of at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
  'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection.',
};

export default function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Turns a browser sign-in into a server session, then enters the app. */
  const finish = async (signIn: () => Promise<UserCredential>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const cred = await signIn();
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken: await cred.user.getIdToken() }),
      });
      if (!res.ok) {
        await clientAuth().signOut();
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? 'Could not sign in.');
      }
      const next = new URLSearchParams(window.location.search).get('next');
      // A full load, so the app starts with the signed-in user's data.
      window.location.href = next?.startsWith('/') ? next : '/';
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') setError(null);
      else setError((code && MESSAGES[code]) || (err instanceof Error ? err.message : 'Could not sign in.'));
      setBusy(false);
    }
  };

  const withEmail = () =>
    finish(() =>
      mode === 'signin'
        ? signInWithEmailAndPassword(clientAuth(), email.trim(), password)
        : createUserWithEmailAndPassword(clientAuth(), email.trim(), password),
    );

  const reset = async () => {
    setError(null);
    if (!email.trim()) {
      setError('Enter your email first, then choose "Forgot password".');
      return;
    }
    try {
      await sendPasswordResetEmail(clientAuth(), email.trim());
      setNotice('If that email has an account, a reset link is on its way.');
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError((code && MESSAGES[code]) || 'Could not send a reset email.');
    }
  };

  return (
    <div className="mx-auto max-w-sm px-5 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
      <p className="mt-2 text-sm text-subtle">
        Your information and CVs are private to your account and follow you to any device.
      </p>

      <Panel className="mt-6 space-y-4 p-5">
        <Button
          className="w-full justify-center"
          onClick={() => finish(() => signInWithPopup(clientAuth(), new GoogleAuthProvider()))}
          disabled={busy}
        >
          Continue with Google
        </Button>

        <div className="flex items-center gap-3 text-xs text-subtle">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void withEmail();
          }}
        >
          <Input
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <Button type="submit" variant="primary" className="w-full justify-center" disabled={busy}>
            {busy && <Spinner />}
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        {error && <ErrorNote>{error}</ErrorNote>}
        {notice && <p className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

        <div className="flex justify-between text-xs text-subtle">
          <button className="hover:text-foreground" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
          {mode === 'signin' && (
            <button className="hover:text-foreground" onClick={reset}>
              Forgot password
            </button>
          )}
        </div>
      </Panel>
    </div>
  );
}
