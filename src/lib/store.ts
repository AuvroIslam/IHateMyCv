import fs from 'node:fs/promises';
import path from 'node:path';
import type { SourceLayout, Store } from '@/types/cv';
import { upgradeStore } from './migrate';
import { DATA_DIR, workspaceDir } from './workspace';

export { DATA_DIR };

/**
 * Everything here belongs to one workspace - one browser's library, design
 * and CVs. Each function finds the requesting browser's workspace itself; work
 * that outlives the request (after()) passes the directory it captured.
 */

const files = (dir: string) => ({
  store: path.join(dir, 'store.json'),
  pages: path.join(dir, 'source-pages'),
  fonts: path.join(dir, 'source-fonts'),
  layout: path.join(dir, 'source-layout.json'),
  pdf: path.join(dir, 'source.pdf'),
});

const EMPTY: Store = {
  version: 1,
  library: null,
  design: null,
  source: null,
  original: null,
  cvs: [],
};

/**
 * Serialises writes per workspace. Route handlers run concurrently in one
 * process, and read-modify-write on a JSON file races without this.
 */
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(dir) ?? Promise.resolve()).then(fn, fn);
  queues.set(
    dir,
    run.catch(() => undefined),
  );
  return run;
}

export async function readStore(dir?: string): Promise<Store> {
  const at = files(dir ?? (await workspaceDir()));
  try {
    const raw = await fs.readFile(/*turbopackIgnore: true*/ at.store, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Store>;
    return upgradeStore({ ...EMPTY, ...parsed });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY };
    throw err;
  }
}

async function writeStoreRaw(dir: string, store: Store): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const target = files(dir).store;
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(tmp, target);
}

/** Read-modify-write under the workspace's lock. */
export async function mutateStore<T>(
  fn: (store: Store) => T | Promise<T>,
  dir?: string,
): Promise<{ store: Store; result: T }> {
  const ws = dir ?? (await workspaceDir());
  return enqueue(ws, async () => {
    const store = await readStore(ws);
    const result = await fn(store);
    await writeStoreRaw(ws, store);
    return { store, result };
  });
}

/** Deletes everything the workspace holds. */
export async function resetStore(): Promise<void> {
  const ws = await workspaceDir();
  await enqueue(ws, () => fs.rm(ws, { recursive: true, force: true }));
}

// ---------------------------------------------------------------------------
// The original's geometry (for auto-align) and the file itself.

export async function saveSourceLayout(layout: SourceLayout | null, pdfBase64?: string) {
  const ws = await workspaceDir();
  const at = files(ws);
  await fs.mkdir(ws, { recursive: true });
  if (layout) await fs.writeFile(at.layout, JSON.stringify(layout), 'utf8');
  else await fs.rm(at.layout, { force: true });
  if (pdfBase64) await fs.writeFile(at.pdf, Buffer.from(pdfBase64, 'base64'));
  else await fs.rm(at.pdf, { force: true });
}

export async function readSourceLayout(): Promise<SourceLayout | null> {
  try {
    return JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ files(await workspaceDir()).layout, 'utf8')) as SourceLayout;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** The originally uploaded PDF, or null when none was kept. */
export async function readSourcePdf(): Promise<Buffer | null> {
  try {
    return await fs.readFile(/*turbopackIgnore: true*/ files(await workspaceDir()).pdf);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Fonts extracted from the original PDF, remapped to Unicode in the browser.

const FONT_ID = /^[a-z0-9]{6,32}$/;

/** Replaces the stored fonts. Ids are generated server-side, never trusted from input. */
export async function saveSourceFonts(fonts: { id: string; format: 'otf' | 'ttf'; data: string }[]) {
  const dir = files(await workspaceDir()).fonts;
  await fs.rm(dir, { recursive: true, force: true });
  if (fonts.length === 0) return;
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(
    fonts.map((f) => fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, `${f.id}.${f.format}`), Buffer.from(f.data, 'base64'))),
  );
}

export async function readSourceFont(id: string): Promise<{ data: Buffer; format: 'otf' | 'ttf' } | null> {
  if (!FONT_ID.test(id)) return null;
  const dir = files(await workspaceDir()).fonts;
  for (const format of ['otf', 'ttf'] as const) {
    try {
      return { data: await fs.readFile(path.join(/*turbopackIgnore: true*/ dir, `${id}.${format}`)), format };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Original page renders. Kept outside store.json: they are large, binary, and
// only ever read one at a time by the design comparison view.

/** Replaces the stored renders. Returns how many were written. */
export async function savePageImages(images: { data: string }[]): Promise<number> {
  const dir = files(await workspaceDir()).pages;
  await fs.rm(dir, { recursive: true, force: true });
  if (images.length === 0) return 0;
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(
    images.map((img, i) => fs.writeFile(path.join(dir, `page-${i + 1}.jpg`), Buffer.from(img.data, 'base64'))),
  );
  return images.length;
}

export async function readPageImage(page: number): Promise<Buffer | null> {
  if (!Number.isInteger(page) || page < 1) return null;
  try {
    return await fs.readFile(path.join(files(await workspaceDir()).pages, `page-${page}.jpg`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
