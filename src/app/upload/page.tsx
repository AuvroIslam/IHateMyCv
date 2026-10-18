'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import CvPreview from '@/components/cv/CvPreview';
import { Button, ErrorNote, Panel, Spinner, cx } from '@/components/ui/kit';
import { buildBaseDocument } from '@/lib/assemble';
import ImportFlow from '@/components/profile/ImportFlow';
import { api } from '@/lib/client-api';
import { normalizeProfile, profileFromLibrary } from '@/lib/profile';
import { parseUpload, toBase64 } from '@/lib/parse-client';
import type { CareerLibrary, DesignSpec } from '@/types/cv';

type Stage = 'idle' | 'parsing' | 'extracting' | 'done';

const STEPS = [
  { key: 'parsing', label: 'Reading the file', detail: 'Pulling text, positions and fonts out of your CV.' },
  { key: 'extracting', label: 'Learning the design', detail: 'Measuring the layout and cataloguing every component.' },
  { key: 'done', label: 'Ready', detail: 'Your design is captured and your content is ready to tailor.' },
] as const;

/**
 * Design capture is one long model call with no intermediate progress, so a
 * running clock is the only honest signal that it has not stalled.
 */
function ExtractingNote() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <p className="mt-4 text-xs text-subtle">
      <span className="font-medium text-foreground tabular-nums">{clock}</span> · Usually about 30
      seconds. Your design and your content are being read side by side; this happens once per CV.
    </p>
  );
}

/**
 * Uploading a CV. Normally it becomes the original - the design CVs follow and
 * the content My Info starts from. With ?as=cv (from My CVs) it is kept as a
 * new CV in its own design instead, leaving the original as it is.
 */
export default function UploadPage({ searchParams }: { searchParams: Promise<{ as?: string | string[] }> }) {
  const router = useRouter();
  const { refresh, library: existingLibrary, hasApiKey, profile } = useApp();
  // After an upload: add its information to My Info? Asked once.
  const [askImport, setAskImport] = useState<'ask' | 'reviewing' | 'answered'>('ask');
  // A new CV needs an original beside it; the very first upload is always the original.
  const asCv = use(searchParams).as === 'cv' && Boolean(existingLibrary);
  const inputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<{
    design: DesignSpec;
    library: CareerLibrary;
    stats: Record<string, number>;
  } | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setResult(null);
      setFileName(file.name);
      try {
        setStage('parsing');
        const parsed = await parseUpload(file);
        if (!parsed.textDump.trim() || parsed.rawText.trim().length < 40) {
          throw new Error(
            'No selectable text found. If this PDF is a scan, export a text-based PDF from the original document instead.',
          );
        }

        setStage('extracting');
        const extracted = await api.extract({
          fileName: parsed.fileName,
          pageCount: parsed.pageCount,
          textDump: parsed.textDump,
          rawText: parsed.rawText,
          images: parsed.images,
          fonts: parsed.fonts,
          layout: parsed.layout,
          backgrounds: parsed.backgrounds,
          pdf: parsed.kind === 'pdf' ? toBase64(new Uint8Array(await file.arrayBuffer())) : undefined,
          asTemplate: asCv,
        });
        if (asCv && extracted.cvId) {
          await refresh();
          router.push(`/cv/${extracted.cvId}`);
          return;
        }

        setResult(extracted);
        setStage('done');
        await refresh();
      } catch (err) {
        setStage('idle');
        setError(err instanceof Error ? err.message : 'Could not read that file.');
      }
    },
    [refresh, asCv, router],
  );

  const busy = stage === 'parsing' || stage === 'extracting';

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{asCv ? 'Upload a CV' : 'Upload your CV'}</h1>
      <p className="mt-2 max-w-2xl text-sm text-subtle">
        {asCv
          ? 'It is added to My CVs exactly as it looks, in its own design, to edit by chat or by hand. Its design also becomes one you can choose when tailoring. Your original CV stays as it is.'
          : 'We read it once: the design is captured so it can be reproduced exactly, and the content is broken into components you can reuse. Your original layout is never redesigned.'}
      </p>

      {!hasApiKey && (
        <Panel className="mt-6 p-4 text-sm">
          <p className="font-medium">An Anthropic API key is required.</p>
          <p className="mt-1 text-subtle">
            Create <code className="rounded bg-foreground/8 px-1">.env.local</code> in the project
            root with <code className="rounded bg-foreground/8 px-1">ANTHROPIC_API_KEY=sk-ant-...</code>{' '}
            and restart the dev server.
          </p>
        </Panel>
      )}

      {existingLibrary && !asCv && stage === 'idle' && (
        <Panel className="mt-6 border-amber-500/40 p-4 text-sm">
          <p className="font-medium">You already have an original CV.</p>
          <p className="mt-1 text-subtle">
            Uploading a new one replaces it and clears the CVs made in its design. My Info, and CVs you added in
            their own design, are kept. To keep this file as an extra CV instead, use{' '}
            <Link href="/upload?as=cv" className="underline">
              Upload a CV
            </Link>
            ; to only add its information, use{' '}
            <Link href="/profile" className="underline">
              Import from CVs in My Info
            </Link>
            .
          </p>
        </Panel>
      )}

      {stage === 'idle' && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={cx(
            'mt-6 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors',
            dragging ? 'border-foreground bg-foreground/5' : 'border-line',
          )}
        >
          <p className="text-sm font-medium">Drop your CV here</p>
          <p className="mt-1 text-sm text-subtle">PDF, DOCX, TXT or MD — up to a few pages.</p>
          <Button variant="primary" className="mt-5" onClick={() => inputRef.current?.click()}>
            Choose a file
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
          <p className="mt-5 text-xs text-subtle">
            PDFs work best — they carry the font, spacing and margin information needed to reproduce
            your design faithfully.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-6">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {(busy || stage === 'done') && (
        <Panel className="mt-6 p-5">
          <p className="text-sm font-medium">{fileName}</p>
          <ol className="mt-4 space-y-3">
            {STEPS.map((step) => {
              const order = ['parsing', 'extracting', 'done'];
              const done = order.indexOf(stage) > order.indexOf(step.key);
              const active = stage === step.key;
              return (
                <li key={step.key} className="flex gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                    {active && step.key !== 'done' ? (
                      <Spinner />
                    ) : done || stage === 'done' ? (
                      <span className="text-emerald-600">✓</span>
                    ) : (
                      <span className="size-2 rounded-full bg-foreground/20" />
                    )}
                  </span>
                  <span>
                    <span className={cx('block text-sm', !active && !done && stage !== 'done' && 'text-subtle')}>
                      {step.label}
                    </span>
                    <span className="block text-xs text-subtle">{step.detail}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {stage === 'extracting' && <ExtractingNote />}
        </Panel>
      )}

      {stage === 'done' && result && (
        <div className="mt-8">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">Here is your CV, rebuilt</h2>
            <span className="text-xs text-subtle">
              {result.stats.sections} sections · {result.stats.entries} entries ·{' '}
              {result.stats.bullets} bullets · {result.stats.skills} skills
            </span>
          </div>
          {askImport !== 'answered' ? (
            <Panel className="mt-4 flex flex-wrap items-center gap-3 border-emerald-500/30 p-4 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">Add the information from this CV to My Info?</p>
                <p className="mt-0.5 text-subtle">
                  My Info is what tailoring picks from. You see every change before anything is saved.
                </p>
              </div>
              <Button variant="primary" onClick={() => setAskImport('reviewing')}>
                Yes, review it
              </Button>
              <Button variant="ghost" onClick={() => setAskImport('answered')}>
                No thanks
              </Button>
            </Panel>
          ) : (
            <p className="mt-1 max-w-2xl text-sm text-subtle">
              Next, tailor a CV for a job. You can compare our rebuild with your original under Original CV at any time.
            </p>
          )}
          {askImport === 'reviewing' && (
            <ImportFlow
              current={normalizeProfile(profile)}
              original={null}
              start={[{ profile: profileFromLibrary(result.library, result.design), from: fileName || 'your CV' }]}
              onApply={async (next) => {
                await api.saveProfile(next);
                await refresh();
              }}
              onDone={() => setAskImport('answered')}
            />
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => router.push('/tailor')}>
              Tailor a CV
            </Button>
            <Button onClick={() => router.push('/profile')}>Go to My Info</Button>
            <Button onClick={() => router.push('/design')}>Compare with the original</Button>
          </div>

          <div className="mt-6 overflow-hidden rounded-lg bg-foreground/5 p-5">
            <CvPreview
              design={result.design}
              data={buildBaseDocument(result.library, result.design)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
