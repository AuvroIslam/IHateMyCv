'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Badge, Button, EmptyState, ErrorNote, LocalDate, Spinner } from '@/components/ui/kit';
import { api } from '@/lib/client-api';

/** Every CV the owner has made: open, duplicate, delete, or upload a new one. */
export default function CvsPage() {
  const { cvs, library, loading, refresh } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-subtle">
        <Spinner className="mr-2" /> Loading…
      </div>
    );
  }

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const duplicate = (copyOf: string) =>
    run(`copy:${copyOf}`, async () => {
      await api.createBlankCv(copyOf);
      await refresh();
    });

  const remove = (id: string, name: string, uploaded: boolean) => {
    const note = uploaded ? ' It will no longer be offered to start tailored CVs from; CVs made from it are kept.' : '';
    if (!confirm(`Delete "${name}"? This cannot be undone.${note}`)) return;
    void run(`del:${id}`, async () => {
      await api.deleteCv(id);
      await refresh();
    });
  };

  const newCv = library && (
    <Link href="/upload">
      <Button variant="primary">+ New CV</Button>
    </Link>
  );

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My CVs</h1>
          <p className="mt-1 text-sm text-subtle">
            Every CV you have made. Open one to edit it by chat or by hand, and to export a PDF.
          </p>
        </div>
        {newCv}
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="mt-8">
        {cvs.length === 0 ? (
          <EmptyState
            title="No CVs yet"
            body={
              library
                ? 'Upload a CV to add it here exactly as it looks, or make one for a job in Tailor a CV.'
                : 'Upload your CV to get started.'
            }
            action={
              <Link href={library ? '/upload' : '/upload'}>
                <Button variant="primary">{library ? '+ New CV' : 'Upload your CV'}</Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {cvs.map((cv) => (
              <li key={cv.id} className="flex items-center gap-2 bg-panel pr-2 hover:bg-foreground/4">
                <Link href={`/cv/${cv.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{cv.name}</p>
                    <p className="text-xs text-subtle">
                      Updated <LocalDate iso={cv.updatedAt} withTime />
                      {cv.template && <> · made from {cv.template.replace(/\.[a-z0-9]+$/i, '')}</>}
                    </p>
                  </div>
                  {cv.uploaded && <Badge>Uploaded</Badge>}
                  {cv.matchScore !== null && (
                    <Badge tone={cv.matchScore >= 70 ? 'good' : cv.matchScore >= 45 ? 'warn' : 'bad'}>
                      {cv.matchScore}% match
                    </Badge>
                  )}
                </Link>
                <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void duplicate(cv.id)}>
                  {busy === `copy:${cv.id}` ? <Spinner /> : 'Duplicate'}
                </Button>
                <Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => remove(cv.id, cv.name, Boolean(cv.uploaded))}>
                  {busy === `del:${cv.id}` ? <Spinner /> : 'Delete'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
