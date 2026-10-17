import fs from 'node:fs/promises';
import path from 'node:path';
import { cookies } from 'next/headers';
import { storageMode } from './backend';
import { currentUser } from './session';
import { LOCAL_WORKSPACE, WORKSPACE_COOKIE, WORKSPACE_ID, perBrowserWorkspaces } from './workspace-id';

// Resolved at run time; the build must not trace the data directory into the bundle.
export const DATA_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), process.env.CV_DATA_DIR || 'data');
const USERS_DIR = path.join(/*turbopackIgnore: true*/ DATA_DIR, 'users');

/** Files a single-user install kept at the top of data/, before workspaces. */
const LEGACY = ['store.json', 'source-pages', 'source-fonts', 'source-layout.json', 'source.pdf'];

export class NoWorkspaceError extends Error {
  constructor(message = 'Your session has no workspace. Reload the page.') {
    super(message);
    this.name = 'NoWorkspaceError';
  }
}

/**
 * Whose data this request works on: the signed-in user's id with Firebase,
 * the browser's workspace cookie with local files. Must be called while a
 * request is in scope; work that outlives it (after()) takes the id along.
 */
export async function workspaceId(): Promise<string> {
  if (storageMode() === 'firebase') {
    const user = await currentUser();
    if (!user) throw new NoWorkspaceError('Sign in to continue.');
    return user.uid;
  }
  const id = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  if (!id || !WORKSPACE_ID.test(id)) throw new NoWorkspaceError();
  // A hand-made cookie must not reach the local workspace of a shared install.
  if (id === LOCAL_WORKSPACE && perBrowserWorkspaces()) throw new NoWorkspaceError();
  if (id === LOCAL_WORKSPACE) await claimLegacy(filesDir(id));
  return id;
}

/** A workspace's folder, for the local-files backend. */
export function filesDir(id: string): string {
  return path.join(/*turbopackIgnore: true*/ USERS_DIR, id);
}

let claiming: Promise<void> | null = null;

/** Data saved before workspaces existed moves into the local workspace. */
function claimLegacy(dir: string): Promise<void> {
  claiming ??= (async () => {
    try {
      await fs.access(path.join(/*turbopackIgnore: true*/ DATA_DIR, 'store.json'));
    } catch {
      return; // nothing to move
    }
    await fs.mkdir(dir, { recursive: true });
    for (const name of LEGACY) {
      await fs
        .rename(path.join(/*turbopackIgnore: true*/ DATA_DIR, name), path.join(/*turbopackIgnore: true*/ dir, name))
        .catch(() => undefined);
    }
  })();
  return claiming;
}
