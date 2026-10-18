'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Button, EmptyState, ErrorNote, Spinner } from '@/components/ui/kit';
import { api } from '@/lib/client-api';

/**
 * The way into chat editing from the nav: chat lives beside a CV, so this
 * opens the CV worked on most recently, or a copy of the original when there
 * is none yet.
 */
export default function ChatPage() {
  const { cvs, library, refresh } = useApp();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Effects run twice in development; a second run must not make a second copy.
  const started = useRef(false);

  useEffect(() => {
    if (!library || started.current) return;
    started.current = true;
    const latest = [...cvs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest) {
      router.replace(`/cv/${latest.id}`);
      return;
    }
    api
      .createBlankCv()
      .then(async ({ cv }) => {
        await refresh();
        router.replace(`/cv/${cv.id}`);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not open a CV to chat about.'));
  }, [cvs, library, refresh, router]);

  if (!library) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16">
        <EmptyState
          title="Upload your CV first"
          body="The chat edits your CV in its original design, so it needs one to work on."
          action={
            <Link href="/upload">
              <Button variant="primary">Upload a CV</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16">
        <ErrorNote>{error}</ErrorNote>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-32 text-sm text-subtle">
      <Spinner className="mr-2" /> Opening your CV…
    </div>
  );
}
