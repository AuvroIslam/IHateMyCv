'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Badge, Button, EmptyState, ErrorNote, LocalDate, Panel, Spinner } from '@/components/ui/kit';
import { api } from '@/lib/client-api';

/** Every CV the owner has made: open, duplicate, delete, or start a new one. */
export default function CvsPage() {
  const { cvs, library, loading, refresh } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

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

  const create = (copyOf?: string) =>
    run(copyOf ? `copy:${copyOf}` : 'new', async () => {
      const { cv } = await api.createBlankCv(copyOf);
      await refresh();
      if (!copyOf) router.push(`/cv/${cv.id}`);
    });

  const remove = (id: string, name: string, template?: string) => {
    // The last CV in an uploaded design takes the design with it.
    const last = template && cvs.filter((c) => c.template === template).length === 1;
    const note = last ? ` Its design (${template}) will no longer be available when tailoring.` : '';
    if (!confirm(`Delete "${name}"? This cannot be undone.${note}`)) return;
    void run(`del:${id}`, async () => {
      await api.deleteCv(id);
      await refresh();
    });
  };

  const newCv = library && (
    <div className="relative">
      <Button variant="primary" onClick={() => setChoosing((v) => !v)}>
        + New CV
      </Button>
      {choosing && (
        <Panel className="absolute right-0 z-20 mt-2 w-80 p-1 shadow-lg">
          <Link href="/upload?as=cv" className="block rounded-md px-3 py-2 hover:bg-foreground/5">
            <span className="block text-sm font-medium">Upload a CV</span>
            <span className="block text-xs text-subtle">
              Another CV file, kept exactly as it looks. Its design can then be used when tailoring.
            </span>
          </Link>
          <Link href="/tailor" className="block rounded-md px-3 py-2 hover:bg-foreground/5">
            <span className="block text-sm font-medium">Tailored for a job</span>
            <span className="block text-xs text-subtle">Paste a job posting; the best fit from My Info is picked.</span>
          </Link>
          <button
            onClick={() => {
              setChoosing(false);
              void create();
            }}
            className="block w-full rounded-md px-3 py-2 text-left hover:bg-foreground/5"
          >
            <span className="block text-sm font-medium">Copy of your original CV</span>
            <span className="block text-xs text-subtle">Your uploaded CV as it is, to change by chat or by hand.</span>
          </button>
        </Panel>
      )}
    </div>
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
      {busy === 'new' && (
        <p className="mt-4 flex items-center gap-2 text-sm text-subtle">
          <Spinner /> Creating…
        </p>
      )}

      <div className="mt-8">
        {cvs.length === 0 ? (
          <EmptyState
            title="No CVs yet"
            body={library ? 'Make your first one with + New CV.' : 'Upload your CV to get started.'}
            action={
              <Link href={library ? '/tailor' : '/upload'}>
                <Button variant="primary">{library ? 'Tailor a CV' : 'Upload your CV'}</Button>
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
                      {cv.template && <> · design from {cv.template}</>}
                    </p>
                  </div>
                  {cv.matchScore !== null && (
                    <Badge tone={cv.matchScore >= 70 ? 'good' : cv.matchScore >= 45 ? 'warn' : 'bad'}>
                      {cv.matchScore}% match
                    </Badge>
                  )}
                </Link>
                <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void create(cv.id)}>
                  {busy === `copy:${cv.id}` ? <Spinner /> : 'Duplicate'}
                </Button>
                <Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => remove(cv.id, cv.name, cv.template)}>
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
