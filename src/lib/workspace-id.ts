/**
 * Each browser gets a private workspace: its own library, design and CVs,
 * found by a random id in a cookie. Kept free of Node imports so the proxy
 * can share it.
 */
export const WORKSPACE_COOKIE = 'cv_ws';

/** 128 random bits as hex: unguessable, and safe as a directory name. */
export const WORKSPACE_ID = /^[a-f0-9]{32}$/;

export function newWorkspaceId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** The single workspace of a local, single-user install. */
export const LOCAL_WORKSPACE = '0'.repeat(32);

/**
 * Per-browser workspaces in production; one shared workspace in development,
 * where the app is one person's tool. WORKSPACES=per-browser|shared overrides.
 */
export function perBrowserWorkspaces(): boolean {
  const mode = process.env.WORKSPACES;
  return mode ? mode === 'per-browser' : process.env.NODE_ENV === 'production';
}
