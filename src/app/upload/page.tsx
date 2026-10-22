'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Button, ErrorNote, Panel, Spinner, cx } from '@/components/ui/kit';
import { api } from '@/lib/client-api';
import { parseUpload, toBase64 } from '@/lib/parse-client';

type Stage = 'idle' | 'compiling' | 'parsing' | 'extracting' | 'done';

const LATEX = /\.(tex|zip)$/i;

const COMPILE_STEP = { key: 'compiling', label: 'Compiling your LaTeX', detail: 'Turning your .tex into a PDF, exactly as LaTeX lays it out.' } as const;

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
 * Uploading a CV: it becomes a CV in My CVs, exactly as it looks, in its own
 * design. Every upload is equal and nothing is replaced. The new CV opens
 * straight away, and asks whether its information goes into My Info.
 */
export default function UploadPage() {
  const router = useRouter();
  const { refresh, hasApiKey } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [latex, setLatex] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setFileName(file.name);
      setLatex(LATEX.test(file.name));
      try {
        // LaTeX is compiled to a PDF first; from there it is an upload like any other.
        if (LATEX.test(file.name)) {
          setStage('compiling');
          const pdf = await api.compileLatex(file);
          file = new File([pdf], file.name.replace(LATEX, '.pdf'), { type: 'application/pdf' });
        }
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
        });
        setStage('done');
        await refresh();
        router.push(extracted.cvId ? `/cv/${extracted.cvId}` : '/cvs');
      } catch (err) {
        setStage('idle');
        setError(err instanceof Error ? err.message : 'Could not read that file.');
      }
    },
    [refresh, router],
  );

  const busy = stage === 'compiling' || stage === 'parsing' || stage === 'extracting';

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Upload a CV</h1>
      <p className="mt-2 max-w-2xl text-sm text-subtle">
        It is added to My CVs exactly as it looks, to edit by chat or by hand, and to start tailored CVs from. Upload as
        many as you like; each keeps its own design.
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
          <p className="mt-1 text-sm text-subtle">
            PDF, DOCX, TXT, MD or LaTeX (a .tex file, or your Overleaf project as a .zip) — up to a few pages.
          </p>
          <Button variant="primary" className="mt-5" onClick={() => inputRef.current?.click()}>
            Choose a file
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.tex,.zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
          <p className="mt-5 text-xs text-subtle">
            PDF and LaTeX work best — they carry the font, spacing and margin information needed to
            reproduce your design faithfully.
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
            {[...(latex ? [COMPILE_STEP] : []), ...STEPS].map((step) => {
              const order = ['compiling', 'parsing', 'extracting', 'done'];
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

    </div>
  );
}
