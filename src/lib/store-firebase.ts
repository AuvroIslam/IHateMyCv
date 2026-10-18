import type { SavedCv, SourceLayout, Store } from '@/types/cv';
import { bucket, db } from './firebase-admin';
import { upgradeStore } from './migrate';
import { workspaceId } from './workspace';

/**
 * The Firebase backend (production). One user's data:
 * - Firestore users/{uid}: the library, design and source details;
 * - Firestore users/{uid}/cvs/{id}: one document per saved CV, chat included;
 * - Storage users/{uid}/...: the uploaded PDF, its layout, page renders, fonts.
 *
 * Documents hold their data as a JSON string. Nothing is ever queried by
 * field, and JSON keeps values Firestore would reject or reshape (undefined,
 * map keys made of bullet text) exactly as the app wrote them. Same
 * interface as store-files.ts; see store.ts.
 */

const EMPTY: Store = { version: 1, library: null, design: null, source: null, original: null, cvs: [] };
/** Firestore's limit is 1 MiB a document; stop well short with a clear message. */
const MAX_DOC = 900_000;

const userDoc = (uid: string) => db().collection('users').doc(uid);
const cvsOf = (uid: string) => userDoc(uid).collection('cvs');
const fileOf = (uid: string, name: string) => bucket().file(`users/${uid}/${name}`);

interface Loaded {
  store: Store;
  /** What is stored now, to write back only what changed. */
  baseJson: string | null;
  cvJson: Map<string, string>;
}

async function load(uid: string): Promise<Loaded> {
  const [snap, cvSnap] = await Promise.all([userDoc(uid).get(), cvsOf(uid).get()]);
  const baseJson = snap.exists ? (snap.get('data') as string) : null;
  const cvJson = new Map<string, string>();
  const cvs: SavedCv[] = [];
  for (const d of cvSnap.docs) {
    const json = d.get('data') as string;
    cvJson.set(d.id, json);
    cvs.push(JSON.parse(json) as SavedCv);
  }
  // Newest first, as the app lists them.
  cvs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const base = baseJson ? (JSON.parse(baseJson) as Partial<Store>) : {};
  return { store: upgradeStore({ ...EMPTY, ...base, cvs }), baseJson, cvJson };
}

export async function readStore(ws?: string): Promise<Store> {
  return (await load(ws ?? (await workspaceId()))).store;
}

/** Writes from one server process are serialised per user. */
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(uid) ?? Promise.resolve()).then(fn, fn);
  queues.set(
    uid,
    run.catch(() => undefined),
  );
  return run;
}

/** Read-modify-write; writes back only the documents that changed. */
export async function mutateStore<T>(
  fn: (store: Store) => T | Promise<T>,
  ws?: string,
): Promise<{ store: Store; result: T }> {
  const uid = ws ?? (await workspaceId());
  return enqueue(uid, async () => {
    const { store, baseJson, cvJson } = await load(uid);
    const result = await fn(store);
    const { cvs, ...base } = store;
    const now = new Date().toISOString();
    const batch = db().batch();

    const nextBase = JSON.stringify(base);
    if (nextBase.length > MAX_DOC) throw new Error('Your Career Library has grown too large to save. Archive some entries.');
    if (nextBase !== baseJson) batch.set(userDoc(uid), { data: nextBase, updatedAt: now });

    const kept = new Set<string>();
    for (const cv of cvs) {
      kept.add(cv.id);
      const json = JSON.stringify(cv);
      if (json.length > MAX_DOC) throw new Error(`"${cv.name}" has grown too large to save. Clear its chat or shorten it.`);
      if (cvJson.get(cv.id) !== json) batch.set(cvsOf(uid).doc(cv.id), { data: json, createdAt: cv.createdAt, updatedAt: now });
    }
    for (const id of cvJson.keys()) if (!kept.has(id)) batch.delete(cvsOf(uid).doc(id));

    await batch.commit();
    return { store, result };
  });
}

/** Deletes everything the user holds: documents and files. */
export async function resetStore(): Promise<void> {
  const uid = await workspaceId();
  await enqueue(uid, async () => {
    const cvs = await cvsOf(uid).listDocuments();
    const batch = db().batch();
    for (const d of cvs) batch.delete(d);
    batch.delete(userDoc(uid));
    await batch.commit();
    await bucket().deleteFiles({ prefix: `users/${uid}/` });
  });
}

// ---------------------------------------------------------------------------
// Files

async function save(uid: string, name: string, data: Buffer | string, contentType: string) {
  await fileOf(uid, name).save(data, { contentType, resumable: false });
}

async function read(uid: string, name: string): Promise<Buffer | null> {
  try {
    const [data] = await fileOf(uid, name).download();
    return data;
  } catch (err) {
    if ((err as { code?: number }).code === 404) return null;
    throw err;
  }
}

async function removePrefix(uid: string, prefix: string) {
  await bucket().deleteFiles({ prefix: `users/${uid}/${prefix}` });
}

export async function saveSourceLayout(layout: SourceLayout | null, pdfBase64?: string) {
  const uid = await workspaceId();
  await Promise.all([
    layout
      ? save(uid, 'source-layout.json', JSON.stringify(layout), 'application/json')
      : fileOf(uid, 'source-layout.json').delete({ ignoreNotFound: true }),
    pdfBase64
      ? save(uid, 'source.pdf', Buffer.from(pdfBase64, 'base64'), 'application/pdf')
      : fileOf(uid, 'source.pdf').delete({ ignoreNotFound: true }),
  ]);
}

export async function readSourceLayout(): Promise<SourceLayout | null> {
  const data = await read(await workspaceId(), 'source-layout.json');
  return data ? (JSON.parse(data.toString('utf8')) as SourceLayout) : null;
}

export async function readSourcePdf(): Promise<Buffer | null> {
  return read(await workspaceId(), 'source.pdf');
}

const FONT_ID = /^[a-z0-9]{6,32}$/;

/** Replaces the stored fonts. Ids are generated server-side, never trusted from input. */
export async function saveSourceFonts(fonts: { id: string; format: 'otf' | 'ttf'; data: string }[]) {
  const uid = await workspaceId();
  await removePrefix(uid, 'source-fonts/');
  await Promise.all(
    fonts.map((f) =>
      save(uid, `source-fonts/${f.id}.${f.format}`, Buffer.from(f.data, 'base64'), f.format === 'otf' ? 'font/otf' : 'font/ttf'),
    ),
  );
}

export async function readSourceFont(id: string): Promise<{ data: Buffer; format: 'otf' | 'ttf' } | null> {
  if (!FONT_ID.test(id)) return null;
  const uid = await workspaceId();
  for (const format of ['otf', 'ttf'] as const) {
    const data = await read(uid, `source-fonts/${id}.${format}`);
    if (data) return { data, format };
  }
  return null;
}

/** Replaces the stored renders. Returns how many were written. */
export async function savePageImages(images: { data: string }[]): Promise<number> {
  const uid = await workspaceId();
  await removePrefix(uid, 'source-pages/');
  await Promise.all(
    images.map((img, i) => save(uid, `source-pages/page-${i + 1}.jpg`, Buffer.from(img.data, 'base64'), 'image/jpeg')),
  );
  return images.length;
}

export async function readPageImage(page: number): Promise<Buffer | null> {
  if (!Number.isInteger(page) || page < 1) return null;
  return read(await workspaceId(), `source-pages/page-${page}.jpg`);
}

/** Replaces the page backgrounds (the original with its text erased). */
export async function savePageBackgrounds(images: { data: string }[]): Promise<number> {
  const uid = await workspaceId();
  await removePrefix(uid, 'source-backgrounds/');
  await Promise.all(
    images.map((img, i) => save(uid, `source-backgrounds/page-${i + 1}.png`, Buffer.from(img.data, 'base64'), 'image/png')),
  );
  return images.length;
}

export async function readPageBackground(page: number): Promise<Buffer | null> {
  if (!Number.isInteger(page) || page < 1) return null;
  return read(await workspaceId(), `source-backgrounds/page-${page}.png`);
}
