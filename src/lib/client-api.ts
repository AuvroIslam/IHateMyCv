'use client';

import type {
  AppStateResponse,
  CareerLibrary,
  CvDocumentData,
  DesignSpec,
  LibraryEntry,
  SavedCv,
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

  saveCv: (id: string, body: { data?: CvDocumentData; name?: string }) =>
    call<{ cv: SavedCv }>(`/api/cvs/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteCv: (id: string) => call<{ ok: true }>(`/api/cvs/${id}`, { method: 'DELETE' }),

  createBlankCv: () => call<{ cv: SavedCv }>('/api/cvs', { method: 'POST' }),
};
