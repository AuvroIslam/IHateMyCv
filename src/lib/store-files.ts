import fs from 'node:fs/promises';
import path from 'node:path';
import type { SourceLayout, Store } from '@/types/cv';
import { upgradeStore } from './migrate';
import { filesDir, workspaceId } from './workspace';

/**
 * The local-files backend (development and tests): each workspace is a
 * folder under data/users/. Same interface as store-firebase.ts; see store.ts.
 */

const dirOf = async (ws?: string) => filesDir(ws ?? (await workspaceId()));

/** A template's files sit in a folder of their own; ids are generated server-side and checked here. */
const TEMPLATE_ID = /^[a-z0-9]{6,32}$/;

const files = (dir: string, template?: string) => {
  if (template && !TEMPLATE_ID.test(template)) throw new Error('Bad template id.');
  const base = template ? path.join(dir, 'templates', template) : dir;
  return {
    store: path.join(dir, 'store.json'),
    base,
    pages: path.join(base, 'source-pages'),
    fonts: path.join(base, 'source-fonts'),
    layout: path.join(base, 'source-layout.json'),
    pdf: path.join(base, 'source.pdf'),
    backgrounds: path.join(base, 'source-backgrounds'),
  };
};

/** Deletes a template's files. */
export async function removeTemplateFiles(template: string) {
  if (!template) return; // never the whole workspace
  const at = files(await dirOf(), template);
  await fs.rm(at.base, { recursive: true, force: true });
}

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

export async function readStore(ws?: string): Promise<Store> {
  return readStoreAt(await dirOf(ws));
}

async function readStoreAt(dir: string): Promise<Store> {
  const at = files(dir);
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
  // Windows refuses to replace a file another request is reading at that
  // moment (EPERM/EBUSY); the read is brief, so try again shortly.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, target);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    }
  }
}

/** Read-modify-write under the workspace's lock. */
export async function mutateStore<T>(
  fn: (store: Store) => T | Promise<T>,
  ws?: string,
): Promise<{ store: Store; result: T }> {
  const dir = await dirOf(ws);
  return enqueue(dir, async () => {
    const store = await readStoreAt(dir);
    const result = await fn(store);
    await writeStoreRaw(dir, store);
    return { store, result };
  });
}

/** Deletes everything the workspace holds. */
export async function resetStore(): Promise<void> {
  const dir = await dirOf();
  await enqueue(dir, () => fs.rm(dir, { recursive: true, force: true }));
}

// ---------------------------------------------------------------------------
// The original's geometry (for auto-align) and the file itself.

export async function saveSourceLayout(layout: SourceLayout | null, pdfBase64?: string, template?: string) {
  const at = files(await dirOf(), template);
  await fs.mkdir(at.base, { recursive: true });
  if (layout) await fs.writeFile(at.layout, JSON.stringify(layout), 'utf8');
  else await fs.rm(at.layout, { force: true });
  if (pdfBase64) await fs.writeFile(at.pdf, Buffer.from(pdfBase64, 'base64'));
  else await fs.rm(at.pdf, { force: true });
}

export async function readSourceLayout(template?: string): Promise<SourceLayout | null> {
  try {
    return JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ files(await dirOf(), template).layout, 'utf8')) as SourceLayout;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** The originally uploaded PDF, or null when none was kept. */
export async function readSourcePdf(template?: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(/*turbopackIgnore: true*/ files(await dirOf(), template).pdf);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Fonts extracted from the original PDF, remapped to Unicode in the browser.

const FONT_ID = /^[a-z0-9]{6,32}$/;

/** Replaces the stored fonts. Ids are generated server-side, never trusted from input. */
export async function saveSourceFonts(fonts: { id: string; format: 'otf' | 'ttf'; data: string }[], template?: string) {
  const dir = files(await dirOf(), template).fonts;
  await fs.rm(dir, { recursive: true, force: true });
  if (fonts.length === 0) return;
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(
    fonts.map((f) => fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, `${f.id}.${f.format}`), Buffer.from(f.data, 'base64'))),
  );
}

export async function readSourceFont(id: string, template?: string): Promise<{ data: Buffer; format: 'otf' | 'ttf' } | null> {
  if (!FONT_ID.test(id)) return null;
  const dir = files(await dirOf(), template).fonts;
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
export async function savePageImages(images: { data: string }[], template?: string): Promise<number> {
  const dir = files(await dirOf(), template).pages;
  await fs.rm(dir, { recursive: true, force: true });
  if (images.length === 0) return 0;
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(
    images.map((img, i) => fs.writeFile(path.join(dir, `page-${i + 1}.jpg`), Buffer.from(img.data, 'base64'))),
  );
  return images.length;
}

export async function readPageImage(page: number, template?: string): Promise<Buffer | null> {
  if (!Number.isInteger(page) || page < 1) return null;
  try {
    return await fs.readFile(path.join(files(await dirOf(), template).pages, `page-${page}.jpg`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Page backgrounds (the original with its text erased) for the exact replica.

export async function savePageBackgrounds(images: { data: string }[], template?: string): Promise<number> {
  const dir = files(await dirOf(), template).backgrounds;
  await fs.rm(dir, { recursive: true, force: true });
  if (images.length === 0) return 0;
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(
    images.map((img, i) => fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, `page-${i + 1}.png`), Buffer.from(img.data, 'base64'))),
  );
  return images.length;
}

export async function readPageBackground(page: number, template?: string): Promise<Buffer | null> {
  if (!Number.isInteger(page) || page < 1) return null;
  try {
    return await fs.readFile(path.join(/*turbopackIgnore: true*/ files(await dirOf(), template).backgrounds, `page-${page}.png`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
