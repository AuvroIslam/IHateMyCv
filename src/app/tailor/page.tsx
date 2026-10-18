'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Button, EmptyState, ErrorNote, Panel, Spinner, Textarea } from '@/components/ui/kit';
import { api } from '@/lib/client-api';

export default function TailorPage() {
  const router = useRouter();
  const { library, design, loading, refresh } = useApp();
  const [jd, setJd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-subtle">
        <Spinner className="mr-2" /> Loading…
      </div>
    );
  }

  if (!library || !design) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-20">
        <EmptyState
          title="Upload a CV first"
          body="Tailoring needs your CV first: its design is what every tailored CV looks like."
          action={
            <Link href="/upload">
              <Button variant="primary">Upload your CV</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { cv } = await api.tailor(jd);
      await refresh();
      router.push(`/cv/${cv.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tailoring failed.');
      setBusy(false);
    }
  };

  const wordCount = jd.trim() ? jd.trim().split(/\s+/).length : 0;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Tailor a CV</h1>
      <p className="mt-2 text-sm text-subtle">
        Paste a job posting. The AI picks the jobs, projects and skills from My Info that fit it best and lays
        them out in your original CV&apos;s design. You can then fine-tune it by chat.
      </p>

      <Textarea
        rows={16}
        className="mt-6 font-mono text-[13px]"
        placeholder="Paste the full job description here — responsibilities, requirements, nice-to-haves, the lot."
        value={jd}
        onChange={(e) => setJd(e.target.value)}
        disabled={busy}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={generate} disabled={busy || jd.trim().length < 80}>
          {busy && <Spinner />}
          {busy ? 'Tailoring…' : 'Generate tailored CV'}
        </Button>
        <span className="text-xs text-subtle">
          {wordCount} words
          {jd.trim().length > 0 && jd.trim().length < 80 && ' · paste a bit more'}
        </span>
      </div>

      {busy && (
        <p className="mt-3 text-xs text-subtle">
          Usually about 20 seconds. The model is ranking every component against the posting.
        </p>
      )}

      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <Panel className="mt-8 p-5 text-sm">
        <p className="font-medium">What changes, and what does not</p>
        <ul className="mt-3 space-y-2 text-subtle">
          <li>
            <span className="text-foreground">Changes:</span> which projects, roles and bullets
            appear, the order within each section, and which skills lead the list.
          </li>
          <li>
            <span className="text-foreground">Never changes:</span> fonts, sizes, margins, rules,
            bullet glyphs, section order, section titles — and the wording of your bullets. Nothing
            is rewritten or invented; the AI can only pick from what is already in your library.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
