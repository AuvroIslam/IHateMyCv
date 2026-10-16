'use client';

import type {
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

  importNotes: (body: { notes: string; sectionId: string }) =>
    call<{ entries: LibraryEntry[]; skills: { category: string; skills: string[] }[] }>(
      '/api/library/import',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  getSourceLayout: () => call<{ layout: SourceLayout }>('/api/source/layout'),

  resetEverything: () => call<{ ok: true }>('/api/library', { method: 'DELETE' }),

  extract: (body: unknown) =>
    call<{ design: DesignSpec; library: CareerLibrary; stats: Record<string, number> }>(
      '/api/extract',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  tailor: (jobDescription: string) =>
    call<{ cv: SavedCv }>('/api/tailor', {
      method: 'POST',
      body: JSON.stringify({ jobDescription }),
    }),

  getCv: (id: string) =>
    call<{ cv: SavedCv; design: DesignSpec | null; library: CareerLibrary | null }>(
      `/api/cvs/${id}`,
    ),

  saveCv: (id: string, body: { data?: CvDocumentData; name?: string; chat?: ChatTurn[] }) =>
    call<{ cv: SavedCv }>(`/api/cvs/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteCv: (id: string) => call<{ ok: true }>(`/api/cvs/${id}`, { method: 'DELETE' }),

  createBlankCv: () => call<{ cv: SavedCv }>('/api/cvs', { method: 'POST' }),

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
