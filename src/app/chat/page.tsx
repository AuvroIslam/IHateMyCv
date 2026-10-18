'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useApp } from '@/components/AppProvider';
import { Button, EmptyState, Spinner } from '@/components/ui/kit';

/** A way into chat editing: chat lives beside a CV, so this opens the CV worked on most recently. */
export default function ChatPage() {
  const { cvs } = useApp();
  const router = useRouter();
  const latest = [...cvs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  useEffect(() => {
    if (latest) router.replace(`/cv/${latest.id}`);
  }, [latest, router]);

  if (!latest) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16">
        <EmptyState
          title="Upload a CV first"
          body="The chat edits a CV, so it needs one to work on."
          action={
            <Link href="/upload">
              <Button variant="primary">Upload a CV</Button>
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center py-32 text-sm text-subtle">
      <Spinner className="mr-2" /> Opening your CV…
    </div>
  );
}
