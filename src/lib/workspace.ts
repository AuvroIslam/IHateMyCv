import fs from 'node:fs/promises';
import path from 'node:path';
import { cookies } from 'next/headers';
import { LOCAL_WORKSPACE, WORKSPACE_COOKIE, WORKSPACE_ID, perBrowserWorkspaces } from './workspace-id';

/** Overridable so a test instance never touches the real data. */
// Resolved at run time; the build must not trace the data directory into the bundle.
export const DATA_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), process.env.CV_DATA_DIR || 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');

/** Files a single-user install kept at the top of data/, before workspaces. */
const LEGACY = ['store.json', 'source-pages', 'source-fonts', 'source-layout.json', 'source.pdf'];

export class NoWorkspaceError extends Error {
  constructor() {
    super('Your session has no workspace. Reload the page.');
    this.name = 'NoWorkspaceError';
  }
}

/**
 * The requesting browser's data directory. Must be called while a request
 * is in scope; work that outlives it (after()) takes the directory along.
 */
export async function workspaceDir(): Promise<string> {
  const id = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  if (!id || !WORKSPACE_ID.test(id)) throw new NoWorkspaceError();
  // A hand-made cookie must not reach the local workspace of a shared install.
  if (id === LOCAL_WORKSPACE && perBrowserWorkspaces()) throw new NoWorkspaceError();
  const dir = path.join(USERS_DIR, id);
  if (id === LOCAL_WORKSPACE) await claimLegacy(dir);
  return dir;
}

let claiming: Promise<void> | null = null;

/** Data saved before workspaces existed moves into the local workspace. */
function claimLegacy(dir: string): Promise<void> {
  claiming ??= (async () => {
    try {
      await fs.access(path.join(DATA_DIR, 'store.json'));
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
