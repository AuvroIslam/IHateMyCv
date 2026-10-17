import { hasApiKey } from './ai';
import { buildBaseDocument } from './assemble';
import { storageMode } from './backend';
import { currentUser } from './session';
import { readStore } from './store';
import type { AppStateResponse, Store } from '@/types/cv';

const EMPTY_STORE: Store = { version: 1, library: null, design: null, source: null, original: null, cvs: [] };

/**
 * The single source of truth for the app shell's state, shared by the server
 * layout and the /api/library endpoint so the two can never disagree.
 */
export async function getAppState(): Promise<AppStateResponse> {
  const signIn = storageMode() === 'firebase';
  const account = signIn ? await currentUser() : null;
  // Signed out (the login page itself renders in this layout): nothing to load.
  const store = signIn && !account ? EMPTY_STORE : await readStore();
  const baseDocument =
    store.library && store.design ? buildBaseDocument(store.library, store.design) : null;
  return {
    library: store.library,
    design: store.design,
    source: store.source,
    hasApiKey: hasApiKey(),
    signIn,
    account: account ? { email: account.email, name: account.name } : null,
    baseDocument,
    originalDocument: store.original ?? baseDocument,
    cvs: store.cvs.map(({ id, name, jobTitle, company, createdAt, updatedAt, report }) => ({
      id,
      name,
      jobTitle,
      company,
      createdAt,
      updatedAt,
      matchScore: report?.matchScore ?? null,
    })),
  };
}
