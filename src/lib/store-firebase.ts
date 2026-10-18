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
/** A template's files sit under templates/<id>/; ids are generated server-side and checked here. */
const TEMPLATE_ID = /^[a-z0-9]{6,32}$/;
const under = (template?: string) => {
  if (template && !TEMPLATE_ID.test(template)) throw new Error('Bad template id.');
  return template ? `templates/${template}/` : '';
};
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

export async function saveSourceLayout(layout: SourceLayout | null, pdfBase64?: string, template?: string) {
  const uid = await workspaceId();
  const at = under(template);
  await Promise.all([
    layout
      ? save(uid, `${at}source-layout.json`, JSON.stringify(layout), 'application/json')
      : fileOf(uid, `${at}source-layout.json`).delete({ ignoreNotFound: true }),
    pdfBase64
      ? save(uid, `${at}source.pdf`, Buffer.from(pdfBase64, 'base64'), 'application/pdf')
      : fileOf(uid, `${at}source.pdf`).delete({ ignoreNotFound: true }),
  ]);
}

export async function readSourceLayout(template?: string): Promise<SourceLayout | null> {
  const data = await read(await workspaceId(), `${under(template)}source-layout.json`);
  return data ? (JSON.parse(data.toString('utf8')) as SourceLayout) : null;
}

export async function readSourcePdf(template?: string): Promise<Buffer | null> {
  return read(await workspaceId(), `${under(template)}source.pdf`);
}

/** Deletes a template's files. */
export async function removeTemplateFiles(template: string) {
  if (!template) return; // never the whole folder
  const uid = await workspaceId();
  await removePrefix(uid, under(template));
}

const FONT_ID = /^[a-z0-9]{6,32}$/;

/** Replaces the stored fonts. Ids are generated server-side, never trusted from input. */
export async function saveSourceFonts(fonts: { id: string; format: 'otf' | 'ttf'; data: string }[], template?: string) {
  const uid = await workspaceId();
  const at = under(template);
  await removePrefix(uid, `${at}source-fonts/`);
  await Promise.all(
    fonts.map((f) =>
      save(uid, `${at}source-fonts/${f.id}.${f.format}`, Buffer.from(f.data, 'base64'), f.format === 'otf' ? 'font/otf' : 'font/ttf'),
    ),
  );
}

export async function readSourceFont(id: string, template?: string): Promise<{ data: Buffer; format: 'otf' | 'ttf' } | null> {
  if (!FONT_ID.test(id)) return null;
  const uid = await workspaceId();
  for (const format of ['otf', 'ttf'] as const) {
    const data = await read(uid, `${under(template)}source-fonts/${id}.${format}`);
    if (data) return { data, format };
  }
  return null;
}

/** Replaces the stored renders. Returns how many were written. */
export async function savePageImages(images: { data: string }[], template?: string): Promise<number> {
  const uid = await workspaceId();
  const at = under(template);
  await removePrefix(uid, `${at}source-pages/`);
  await Promise.all(
    images.map((img, i) => save(uid, `${at}source-pages/page-${i + 1}.jpg`, Buffer.from(img.data, 'base64'), 'image/jpeg')),
  );
  return images.length;
}

export async function readPageImage(page: number, template?: string): Promise<Buffer | null> {
  if (!Number.isInteger(page) || page < 1) return null;
  return read(await workspaceId(), `${under(template)}source-pages/page-${page}.jpg`);
}

/** Replaces the page backgrounds (the original with its text erased). */
export async function savePageBackgrounds(images: { data: string }[], template?: string): Promise<number> {
  const uid = await workspaceId();
  const at = under(template);
  await removePrefix(uid, `${at}source-backgrounds/`);
  await Promise.all(
    images.map((img, i) => save(uid, `${at}source-backgrounds/page-${i + 1}.png`, Buffer.from(img.data, 'base64'), 'image/png')),
  );
  return images.length;
}

export async function readPageBackground(page: number, template?: string): Promise<Buffer | null> {
  if (!Number.isInteger(page) || page < 1) return null;
  return read(await workspaceId(), `${under(template)}source-backgrounds/page-${page}.png`);
}
