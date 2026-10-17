/**
 * Where data lives. `firebase` in production: sign-in with Firebase Auth,
 * data in Firestore, files in Firebase Storage. `files` in development: the
 * local data/ folder and no sign-in, so a local install and the test suites
 * never touch the real project. STORAGE=files|firebase overrides either.
 * Free of Node imports so the proxy can share it.
 */
export type StorageMode = 'files' | 'firebase';

export function storageMode(): StorageMode {
  const mode = process.env.STORAGE;
  if (mode === 'files' || mode === 'firebase') return mode;
  return process.env.NODE_ENV === 'production' ? 'firebase' : 'files';
}

/** The cookie holding a signed-in user's Firebase session. */
export const SESSION_COOKIE = '__session';
