import { hasApiKey } from './ai';
import { buildBaseDocument } from './assemble';
import { readStore } from './store';
import type { AppStateResponse } from '@/types/cv';

/**
 * The single source of truth for the app shell's state, shared by the server
 * layout and the /api/library endpoint so the two can never disagree.
 */
export async function getAppState(): Promise<AppStateResponse> {
  const store = await readStore();
  const baseDocument =
    store.library && store.design ? buildBaseDocument(store.library, store.design) : null;
  return {
    library: store.library,
    design: store.design,
    source: store.source,
    hasApiKey: hasApiKey(),
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
