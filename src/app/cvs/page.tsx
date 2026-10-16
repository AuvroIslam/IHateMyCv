'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Badge, Button, EmptyState, ErrorNote, LocalDate, Spinner } from '@/components/ui/kit';
import { api } from '@/lib/client-api';

export default function CvsPage() {
  const { cvs, library, loading, refresh } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-subtle">
        <Spinner className="mr-2" /> Loading…
      </div>
    );
  }

  const createBlank = async () => {
    setBusy(true);
    setError(null);
    try {
      const { cv } = await api.createBlankCv();
      await refresh();
      router.push(`/cv/${cv.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a CV.');
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My CVs</h1>
          <p className="mt-1 text-sm text-subtle">
            Every version shares one design. Only the content differs.
          </p>
        </div>
        <div className="flex gap-2">
          {library && (
            <Button onClick={createBlank} disabled={busy}>
              {busy && <Spinner />} Start from the full CV
            </Button>
          )}
          <Link href="/tailor">
            <Button variant="primary">Tailor for a job</Button>
          </Link>
        </div>
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
                ? 'Paste a job description and the first tailored version will appear here.'
                : 'Upload your CV to get started.'
            }
            action={
              <Link href={library ? '/tailor' : '/upload'}>
                <Button variant="primary">{library ? 'Tailor for a job' : 'Upload your CV'}</Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {cvs.map((cv) => (
              <li key={cv.id}>
                <Link
                  href={`/cv/${cv.id}`}
                  className="flex items-center gap-3 bg-panel px-4 py-3 hover:bg-foreground/4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{cv.name}</p>
                    <p className="text-xs text-subtle">
                      Updated <LocalDate iso={cv.updatedAt} withTime />
                    </p>
                  </div>
                  {cv.matchScore !== null && (
                    <Badge
                      tone={cv.matchScore >= 70 ? 'good' : cv.matchScore >= 45 ? 'warn' : 'bad'}
                    >
                      {cv.matchScore}%
                    </Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
