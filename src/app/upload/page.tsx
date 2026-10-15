'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import CvPreview from '@/components/cv/CvPreview';
import { Button, ErrorNote, Panel, Spinner, cx } from '@/components/ui/kit';
import { buildBaseDocument } from '@/lib/assemble';
import { api } from '@/lib/client-api';
import { parseUpload, toBase64 } from '@/lib/parse-client';
import type { CareerLibrary, DesignSpec } from '@/types/cv';

type Stage = 'idle' | 'parsing' | 'extracting' | 'done';

const STEPS = [
  { key: 'parsing', label: 'Reading the file', detail: 'Pulling text, positions and fonts out of your CV.' },
  { key: 'extracting', label: 'Learning the design', detail: 'Measuring the layout and cataloguing every component.' },
  { key: 'done', label: 'Career Library built', detail: 'Your CV is now a reusable set of parts.' },
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
      <span className="font-medium text-foreground tabular-nums">{clock}</span> · Usually 2–4
      minutes. The model is measuring your layout from the page images and cataloguing every
      component, and it only has to do this once. Keep this tab open.
    </p>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const { refresh, library: existingLibrary, hasApiKey } = useApp();
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
          pdf: parsed.kind === 'pdf' ? toBase64(new Uint8Array(await file.arrayBuffer())) : undefined,
        });

        setResult(extracted);
        setStage('done');
        await refresh();
      } catch (err) {
        setStage('idle');
        setError(err instanceof Error ? err.message : 'Could not read that file.');
      }
    },
    [refresh],
  );

  const busy = stage === 'parsing' || stage === 'extracting';

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Upload your CV</h1>
      <p className="mt-2 max-w-2xl text-sm text-subtle">
        We read it once: the design is captured so it can be reproduced exactly, and the content is
        broken into components you can reuse. Your original layout is never redesigned.
      </p>

      {!hasApiKey && (
        <Panel className="mt-6 p-4 text-sm">
          <p className="font-medium">An OpenAI API key is required.</p>
          <p className="mt-1 text-subtle">
            Create <code className="rounded bg-foreground/8 px-1">.env.local</code> in the project
            root with <code className="rounded bg-foreground/8 px-1">OPENAI_API_KEY=sk-...</code>{' '}
            and restart the dev server.
          </p>
        </Panel>
      )}

      {existingLibrary && stage === 'idle' && (
        <Panel className="mt-6 border-amber-500/40 p-4 text-sm">
          <p className="font-medium">You already have a Career Library.</p>
          <p className="mt-1 text-subtle">
            Uploading a new CV replaces the captured design, rebuilds the library, and clears
            previously generated CVs. To just add material, edit the{' '}
            <Link href="/library" className="underline">
              Career Library
            </Link>{' '}
            instead.
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
          <p className="mt-1 max-w-2xl text-sm text-subtle">
            Check it against your original first: the design check overlays the two so any drift
            in fonts or spacing shows up, and a fix there carries into every tailored CV. Wrong
            content is corrected in the Career Library.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => router.push('/design')}>
              Check the design
            </Button>
            <Button onClick={() => router.push('/library')}>Review the Career Library</Button>
            <Button onClick={() => router.push('/tailor')}>Tailor for a job</Button>
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
