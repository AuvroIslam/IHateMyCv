import { hasApiKey } from './ai';
import { buildBaseDocument } from './assemble';
import { storageMode } from './backend';
import { currentUser } from './session';
import { newId } from './id';
import { mutateStore, readStore } from './store';
import type { AppStateResponse, SavedCv, Store } from '@/types/cv';

const EMPTY_STORE: Store = { version: 1, library: null, design: null, source: null, original: null, cvs: [] };

/**
 * The single source of truth for the app shell's state, shared by the server
 * layout and the /api/library endpoint so the two can never disagree.
 */
export async function getAppState(): Promise<AppStateResponse> {
  const signIn = storageMode() === 'firebase';
  const account = signIn ? await currentUser() : null;
  // Signed out (the login page itself renders in this layout): nothing to load.
  let store = signIn && !account ? EMPTY_STORE : await readStore();
  // The first upload predates uploads becoming CVs of their own: give it its
  // CV once, as every later upload gets at upload time.
  if (store !== EMPTY_STORE && needsFirstCv(store)) {
    store = (await mutateStore((s) => {
      if (needsFirstCv(s)) s.cvs.push(firstCv(s));
    })).store;
  }
  const baseDocument =
    store.library && store.design ? buildBaseDocument(store.library, store.design) : null;
  return {
    library: store.library,
    templates: [
      ...(store.source && !store.firstHidden
        ? [{ id: null, fileName: store.source.fileName, uploadedAt: store.source.uploadedAt, pageCount: store.source.pageCount }]
        : []),
      ...(store.templates ?? [])
        .filter((t) => !t.hidden)
        .map((t) => ({ id: t.id, fileName: t.source.fileName, uploadedAt: t.source.uploadedAt, pageCount: t.source.pageCount })),
    ],
    profile: store.profile ?? null,
    design: store.design,
    source: store.source,
    hasApiKey: hasApiKey(),
    signIn,
    account: account ? { email: account.email, name: account.name } : null,
    baseDocument,
    originalDocument: store.original ?? baseDocument,
    cvs: store.cvs.map(({ id, name, jobTitle, company, createdAt, updatedAt, report, templateId, uploaded }) => ({
      id,
      name,
      uploaded: Boolean(uploaded),
      template: uploaded
        ? undefined
        : templateId
          ? store.templates?.find((t) => t.id === templateId)?.source.fileName
          : store.source?.fileName,
      jobTitle,
      company,
      createdAt,
      updatedAt,
      matchScore: report?.matchScore ?? null,
    })),
  };
}

const needsFirstCv = (s: Store) =>
  Boolean(s.library && s.design && s.source && !s.firstHidden && !s.cvs.some((c) => c.uploaded && !c.templateId));

/** The first upload as a CV of its own: what that file said, in its own design. */
export function firstCv(s: Store): SavedCv {
  const at = s.source?.uploadedAt ?? new Date().toISOString();
  return {
    id: newId(),
    name: (s.source?.fileName ?? 'My CV').replace(/\.[a-z0-9]+$/i, ''),
    uploaded: true,
    jobDescription: '',
    createdAt: at,
    updatedAt: at,
    data: structuredClone(s.original ?? buildBaseDocument(s.library!, s.design!)),
    report: null,
  };
}
