import fs from 'node:fs/promises';
import path from 'node:path';
import type { Store } from '@/types/cv';

export const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const PAGES_DIR = path.join(DATA_DIR, 'source-pages');

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
    return { ...EMPTY, ...parsed };
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
  });
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
