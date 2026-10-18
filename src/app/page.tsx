'use client';

import Link from 'next/link';
import { useApp } from '@/components/AppProvider';
import { Button, LocalDate, Panel, Spinner } from '@/components/ui/kit';
import { PROFILE_KINDS, normalizeProfile } from '@/lib/profile';

const STEPS = [
  {
    title: 'Upload your CVs',
    body: 'Each one is kept exactly as it looks (fonts, spacing, layout), ready to edit or to start tailored CVs from.',
  },
  {
    title: 'Add everything about you',
    body: 'Every job, project and achievement in My Info, including what never fit on one page. Import older CVs in a click.',
  },
  {
    title: 'Tailor a CV for each job',
    body: 'Paste a job posting. The AI picks what fits best, in your design. Fine-tune it by chatting, then export a PDF.',
  },
];

export default function HomePage() {
  const { library, design, cvs, profile, loading } = useApp();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-subtle">
        <Spinner className="mr-2" /> Loading…
      </div>
    );
  }

  if (!library || !design) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-20">
        <h1 className="text-4xl font-semibold tracking-tight">Stop rewriting your CV for every job.</h1>
        <p className="mt-4 max-w-2xl text-lg text-subtle">
          Upload your CV once, keep everything about you in one place, and get a tailored CV for every job, in your
          own design.
        </p>
        <div className="mt-8">
          <Link href="/upload">
            <Button variant="primary">Upload your CV</Button>
          </Link>
        </div>
        <Steps />
      </div>
    );
  }

  const info = normalizeProfile(profile);
  const counts = PROFILE_KINDS.map((k) => ({ ...k, n: info.entries.filter((e) => e.sectionId === k.kind).length })).filter((k) => k.n);
  const firstName = (info.personal.fullName || library.personal.fullName).trim().split(/\s+/)[0] ?? '';
  const hello = firstName ? firstName[0].toUpperCase() + firstName.slice(1).toLowerCase() : '';

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{hello ? `Hi, ${hello}` : 'Welcome back'}</h1>
      <p className="mt-1 text-sm text-subtle">Three steps to a CV for any job.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card
          n={1}
          title="My Info"
          body={
            counts.length
              ? `${counts.map((k) => `${k.n} ${k.n === 1 ? k.one : k.label.toLowerCase()}`).join(' · ')}. Add anything that never fit on the page.`
              : 'Not filled in yet. Import your CV in one click, then add everything else about you.'
          }
          href="/profile"
          action={counts.length ? 'Open My Info' : 'Fill in My Info'}
          primary={!counts.length}
        />
        <Card
          n={2}
          title="Tailor a CV"
          body="Paste a job posting and get a CV that fits it, in your design."
          href="/tailor"
          action="Tailor a CV"
          primary={counts.length > 0}
        />
        <Card
          n={3}
          title="Edit and export"
          body={
            cvs.length
              ? 'Open a CV to change it by chatting ("make it one page") or by hand, then export a PDF.'
              : 'Your CVs appear here. Chat with any of them to change words, colours or fonts.'
          }
          href={cvs.length ? '/cvs' : '/chat'}
          action={cvs.length ? `My CVs (${cvs.length})` : 'Try the chat'}
        />
      </div>

      {cvs.length > 0 && (
        <div className="mt-8">
          <p className="text-sm font-medium">Recent CVs</p>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line">
            {cvs.slice(0, 5).map((cv) => (
              <li key={cv.id}>
                <Link
                  href={`/cv/${cv.id}`}
                  className="flex items-center justify-between gap-4 bg-panel px-4 py-3 text-sm hover:bg-foreground/4"
                >
                  <span className="truncate">{cv.name}</span>
                  <span className="shrink-0 text-xs text-subtle">
                    {cv.matchScore !== null && `${cv.matchScore}% match · `}
                    <LocalDate iso={cv.updatedAt} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}

function Card({
  n,
  title,
  body,
  href,
  action,
  primary,
}: {
  n: number;
  title: string;
  body: string;
  href: string;
  action: string;
  primary?: boolean;
}) {
  return (
    <Panel className="flex flex-col p-5">
      <span className="text-xs font-medium text-subtle">Step {n}</span>
      <p className="mt-1 font-medium">{title}</p>
      <p className="mt-1 flex-1 text-sm text-subtle">{body}</p>
      <Link href={href} className="mt-4">
        <Button variant={primary ? 'primary' : undefined}>{action}</Button>
      </Link>
    </Panel>
  );
}

function Steps() {
  return (
    <div className="mt-16 grid gap-4 sm:grid-cols-3">
      {STEPS.map((step, i) => (
        <Panel key={step.title} className="p-5">
          <span className="text-xs font-medium text-subtle">0{i + 1}</span>
          <p className="mt-2 font-medium">{step.title}</p>
          <p className="mt-2 text-sm text-subtle">{step.body}</p>
        </Panel>
      ))}
    </div>
  );
}
