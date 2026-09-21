'use client';

import Link from 'next/link';
import { useApp } from '@/components/AppProvider';
import { Button, Panel, Spinner } from '@/components/ui/kit';

const STEPS = [
  {
    title: 'Upload once',
    body: 'We capture your CV’s design — fonts, margins, rules, spacing, section order — and break the content into reusable components.',
  },
  {
    title: 'Build your library',
    body: 'Add the projects, roles, bullets and skills that never fit on one page. The library is everything you could say about yourself.',
  },
  {
    title: 'Paste a job, get a CV',
    body: 'The AI picks and reorders the components that match, and renders them into your original design. Same look, different argument.',
  },
];

export default function HomePage() {
  const { library, design, source, cvs, loading } = useApp();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-subtle">
        <Spinner className="mr-2" /> Loading your Career Library…
      </div>
    );
  }

  if (!library || !design) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-20">
        <h1 className="text-4xl font-semibold tracking-tight">
          Stop rewriting your CV for every job.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-subtle">
          Upload your CV once, build a Career Library, and generate a tailored CV for every job —
          without redesigning it from scratch.
        </p>
        <div className="mt-8">
          <Link href="/upload">
            <Button variant="primary">Upload your CV</Button>
          </Link>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <Panel key={step.title} className="p-5">
              <span className="text-xs font-medium text-subtle">0{i + 1}</span>
              <p className="mt-2 font-medium">{step.title}</p>
              <p className="mt-2 text-sm text-subtle">{step.body}</p>
            </Panel>
          ))}
        </div>

        <Panel className="mt-8 p-5">
          <p className="text-sm font-medium">Your design is the one thing we never touch.</p>
          <p className="mt-2 text-sm text-subtle">
            Tailoring changes which components appear and in what order. It does not restyle your
            CV, move your sections around, or rewrite your bullets into someone else’s voice.
          </p>
        </Panel>
      </div>
    );
  }

  const entryCount = library.entries.length;
  const bulletCount = library.entries.reduce((n, e) => n + e.bullets.length, 0);
  const skillCount = library.skillGroups.reduce((n, g) => n + g.skills.length, 0);

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {library.personal.fullName || 'Your Career Library'}
          </h1>
          <p className="mt-1 text-sm text-subtle">
            {source
              ? `Captured from ${source.fileName} on ${new Date(source.uploadedAt).toLocaleDateString()}.`
              : 'Career Library ready.'}
          </p>
        </div>
        <Link href="/tailor">
          <Button variant="primary">Tailor for a job</Button>
        </Link>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Sections" value={design.sections.length} />
        <Stat label="Components" value={entryCount} />
        <Stat label="Bullets" value={bulletCount} />
        <Stat label="Skills" value={skillCount} />
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Panel className="p-5">
          <p className="font-medium">Career Library</p>
          <p className="mt-1 text-sm text-subtle">
            Add the work that did not fit on one page. The more the library holds, the sharper each
            tailored CV can be.
          </p>
          <Link href="/library" className="mt-4 inline-block">
            <Button>Open library</Button>
          </Link>
        </Panel>

        <Panel className="p-5">
          <p className="font-medium">Generated CVs</p>
          <p className="mt-1 text-sm text-subtle">
            {cvs.length === 0
              ? 'Nothing generated yet. Paste a job description to make your first tailored CV.'
              : `${cvs.length} tailored ${cvs.length === 1 ? 'CV' : 'CVs'} so far.`}
          </p>
          <Link href="/cvs" className="mt-4 inline-block">
            <Button>View CVs</Button>
          </Link>
        </Panel>
      </div>

      {cvs.length > 0 && (
        <div className="mt-8">
          <p className="text-sm font-medium">Recent</p>
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
                    {new Date(cv.updatedAt).toLocaleDateString()}
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Panel className="px-4 py-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-subtle">{label}</p>
    </Panel>
  );
}
