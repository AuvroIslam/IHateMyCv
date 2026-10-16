import fs from 'node:fs/promises';
import path from 'node:path';
import type { SourceLayout, Store } from '@/types/cv';
import { upgradeStore } from './migrate';

/** Overridable so a test instance never touches the real library. */
export const DATA_DIR = path.join(process.cwd(), process.env.CV_DATA_DIR || 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const PAGES_DIR = path.join(DATA_DIR, 'source-pages');
const FONTS_DIR = path.join(DATA_DIR, 'source-fonts');
const LAYOUT_PATH = path.join(DATA_DIR, 'source-layout.json');
const PDF_PATH = path.join(DATA_DIR, 'source.pdf');

const EMPTY: Store = {
  version: 1,
  library: null,
  design: null,
  source: null,
  original: null,
  cvs: [],
};

/**
 * Serialises writes. Next.js route handlers can run concurrently in the same
 * process, and read-modify-write on a single JSON file races without this.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Store>;
    return upgradeStore({ ...EMPTY, ...parsed });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY };
    throw err;
  }
}

async function writeStoreRaw(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(tmp, STORE_PATH);
}

/** Read-modify-write under the queue lock. */
export function mutateStore<T>(
  fn: (store: Store) => T | Promise<T>,
): Promise<{ store: Store; result: T }> {
  return enqueue(async () => {
    const store = await readStore();
    const result = await fn(store);
    await writeStoreRaw(store);
    return { store, result };
  });
}

export async function resetStore(): Promise<void> {
  await enqueue(async () => {
    await writeStoreRaw({ ...EMPTY });
    await fs.rm(PAGES_DIR, { recursive: true, force: true });
    await fs.rm(FONTS_DIR, { recursive: true, force: true });
    await fs.rm(LAYOUT_PATH, { force: true });
    await fs.rm(PDF_PATH, { force: true });
  });
}

// ---------------------------------------------------------------------------
// The original's geometry (for auto-align) and the file itself.

export async function saveSourceLayout(layout: SourceLayout | null, pdfBase64?: string) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (layout) await fs.writeFile(LAYOUT_PATH, JSON.stringify(layout), 'utf8');
  else await fs.rm(LAYOUT_PATH, { force: true });
  if (pdfBase64) await fs.writeFile(PDF_PATH, Buffer.from(pdfBase64, 'base64'));
  else await fs.rm(PDF_PATH, { force: true });
}

export async function readSourceLayout(): Promise<SourceLayout | null> {
  try {
    return JSON.parse(await fs.readFile(LAYOUT_PATH, 'utf8')) as SourceLayout;
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
  await fs.rm(FONTS_DIR, { recursive: true, force: true });
  if (fonts.length === 0) return;
  await fs.mkdir(FONTS_DIR, { recursive: true });
  await Promise.all(
    fonts.map((f) => fs.writeFile(path.join(FONTS_DIR, `${f.id}.${f.format}`), Buffer.from(f.data, 'base64'))),
  );
}

export async function readSourceFont(id: string): Promise<{ data: Buffer; format: 'otf' | 'ttf' } | null> {
  if (!FONT_ID.test(id)) return null;
  for (const format of ['otf', 'ttf'] as const) {
    try {
      return { data: await fs.readFile(path.join(FONTS_DIR, `${id}.${format}`)), format };
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
  await fs.rm(PAGES_DIR, { recursive: true, force: true });
  if (images.length === 0) return 0;
  await fs.mkdir(PAGES_DIR, { recursive: true });
  await Promise.all(
    images.map((img, i) =>
      fs.writeFile(path.join(PAGES_DIR, `page-${i + 1}.jpg`), Buffer.from(img.data, 'base64')),
    ),
  );
  return images.length;
}

export async function readPageImage(page: number): Promise<Buffer | null> {
  if (!Number.isInteger(page) || page < 1) return null;
  try {
    return await fs.readFile(path.join(PAGES_DIR, `page-${page}.jpg`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
