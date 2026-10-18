'use client';

import type {
  Profile,
  SourceMeta,
  AppStateResponse,
  CareerLibrary,
  ChatTurn,
  CvDocumentData,
  DesignSpec,
  LibraryEntry,
  SavedCv,
  SourceLayout,
} from '@/types/cv';

export type { AppStateResponse, CvSummary } from '@/types/cv';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Unexpected response from ${url}.`);
  }
  // The session ran out: back to the login page rather than a broken screen.
  if (res.status === 401 && !url.startsWith('/api/session') && window.location.pathname !== '/login') {
    window.location.assign(new URL(`/login?next=${encodeURIComponent(window.location.pathname)}`, window.location.origin).href);
  }
  if (!res.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export const api = {
  getLibrary: () => call<AppStateResponse>('/api/library'),

  saveLibrary: (body: { library?: CareerLibrary; design?: DesignSpec }) =>
    call<{ library: CareerLibrary; design: DesignSpec }>('/api/library', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  /** One CV's text read into Profile form, to compare with My Info; nothing is saved. */
  readCvIntoProfile: (body: { textDump: string; fileName: string }) =>
    call<{ profile: Profile }>('/api/profile/import', { method: 'POST', body: JSON.stringify(body) }),

  saveProfile: (profile: Profile) =>
    call<{ profile: Profile }>('/api/profile', { method: 'PUT', body: JSON.stringify({ profile }) }),

  importNotes: (body: { notes: string; sectionId: string }) =>
    call<{ entries: LibraryEntry[]; skills: { category: string; skills: string[] }[] }>(
      '/api/library/import',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  getSourceLayout: (template?: string) =>
    call<{ layout: SourceLayout }>(`/api/source/layout${template ? `?template=${encodeURIComponent(template)}` : ''}`),

  resetEverything: () => call<{ ok: true }>('/api/library', { method: 'DELETE' }),

  /** Reads an upload. With `asTemplate`, it becomes a new CV in its own design and `cvId` names it. */
  extract: (body: unknown) =>
    call<{ design: DesignSpec; library: CareerLibrary; stats: Record<string, number>; cvId?: string }>(
      '/api/extract',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /** `templateId`: the uploaded CV whose design to follow; null or absent for the original's. */
  tailor: (jobDescription: string, templateId?: string | null, reword = true) =>
    call<{ cv: SavedCv }>('/api/tailor', {
      method: 'POST',
      body: JSON.stringify({ jobDescription, templateId, reword }),
    }),

  saveTemplateDesign: (id: string, design: DesignSpec) =>
    call<{ ok: true }>(`/api/templates/${id}`, { method: 'PUT', body: JSON.stringify({ design }) }),

  getCv: (id: string) =>
    call<{
      cv: SavedCv;
      design: DesignSpec | null;
      library: CareerLibrary | null;
      /** The template it follows, when not the original's design. */
      template: { id: string; source: SourceMeta; original: CvDocumentData } | null;
    }>(`/api/cvs/${id}`),

  saveCv: (id: string, body: { data?: CvDocumentData; name?: string; chat?: ChatTurn[]; askedImport?: boolean }) =>
    call<{ cv: SavedCv }>(`/api/cvs/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteCv: (id: string) => call<{ ok: true }>(`/api/cvs/${id}`, { method: 'DELETE' }),

  /** A copy of the original CV, or with `copyOf`, a duplicate of one of the owner's CVs. */
  createBlankCv: (copyOf?: string) =>
    call<{ cv: SavedCv }>('/api/cvs', { method: 'POST', body: JSON.stringify(copyOf ? { copyOf } : {}) }),

  /** Streams a chat message's events (see /api/cvs/[id]/chat) to `onEvent`. */
  chatCv: async (
    id: string,
    body: { message: string; data: CvDocumentData; history: ChatTurn[]; pages?: { now?: number; original?: number } },
    onEvent: (event: ChatEvent) => void,
    signal?: AbortSignal,
  ) => {
    const res = await fetch(`/api/cvs/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.error ?? `Chat failed (${res.status}).`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 2);
        if (chunk.startsWith('data: ')) onEvent(JSON.parse(chunk.slice(6)) as ChatEvent);
      }
    }
  },
};

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'reset' }
  | { type: 'edit'; data: CvDocumentData; change: string }
  | { type: 'done'; data: CvDocumentData; text: string; changes: string[] }
  | { type: 'error'; message: string; data: CvDocumentData; changes: string[] };
