'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import CvPreview from '@/components/cv/CvPreview';
import DesignEditor from '@/components/design/DesignEditor';
import { Button, EmptyState, ErrorNote, Panel, Spinner, cx } from '@/components/ui/kit';
import { autoAlign } from '@/lib/auto-align';
import { api } from '@/lib/client-api';
import type { DesignSpec } from '@/types/cv';

type View = 'side' | 'overlay' | 'rebuilt';

export default function DesignPage() {
  const { design, source, originalDocument, saveLibrary } = useApp();
  const [draft, setDraft] = useState<DesignSpec | null>(null);
  const [view, setView] = useState<View>('overlay');
  const [opacity, setOpacity] = useState(0.5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same seeding pattern as the library page: once per distinct saved design.
  const [seededFrom, setSeededFrom] = useState<DesignSpec | null>(null);
  if (design && design !== seededFrom) {
    setSeededFrom(design);
    if (!draft) setDraft(structuredClone(design));
  }

  const dirty = useMemo(
    () => Boolean(draft && design && JSON.stringify(draft) !== JSON.stringify(design)),
    [draft, design],
  );

  const pageSrcs = useMemo(() => {
    const count = source?.pageImages ?? 0;
    // The upload time versions the URL so a re-upload never shows a cached page.
    const v = encodeURIComponent(source?.uploadedAt ?? '');
    return Array.from({ length: count }, (_, i) => `/api/source/pages/${i + 1}?v=${v}`);
  }, [source]);

  const [aligning, setAligning] = useState<string | null>(null);
  const [alignNote, setAlignNote] = useState<string | null>(null);

  const runAlign = useCallback(
    async (from: DesignSpec) => {
      if (!originalDocument) return;
      setAlignNote(null);
      setAligning('Measuring your original…');
      try {
        const { layout } = await api.getSourceLayout();
        const { design: fitted, report } = await autoAlign(from, originalDocument, layout, (round, r) =>
          setAligning(`Round ${round}: typical gap error ${r.verticalError.toFixed(2)}pt…`),
        );
        setDraft(fitted);
        await saveLibrary({ design: fitted });
        setAlignNote(
          `Aligned to your original: ${report.matched} of ${report.total} elements matched, typical spacing error ${report.verticalError.toFixed(2)}pt.`,
        );
      } catch (err) {
        setAlignNote(
          err instanceof Error && /No layout/.test(err.message)
            ? 'Auto-align needs the positions from your PDF, which this upload predates. Re-upload the PDF to enable it.'
            : `Auto-align failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      } finally {
        setAligning(null);
      }
    },
    [originalDocument, saveLibrary],
  );

  // A fresh upload is aligned once, automatically.
  const autoTried = useRef(false);
  useEffect(() => {
    if (design && !design.aligned && !autoTried.current && originalDocument && (source?.pageImages ?? 0) > 0) {
      autoTried.current = true;
      void runAlign(design);
    }
  }, [design, originalDocument, source, runAlign]);

  if (!design || !draft || !originalDocument) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-20">
        <EmptyState
          title="No captured design yet"
          body="Upload your CV first. Its design is captured once and reused for every tailored version."
          action={
            <Link href="/upload">
              <Button variant="primary">Upload your CV</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const hasOriginal = pageSrcs.length > 0;
  const effectiveView: View = hasOriginal ? view : 'rebuilt';

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveLibrary({ design: draft });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the design.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Design check</h1>
          <p className="mt-1 max-w-2xl text-sm text-subtle">
            Your original CV next to our rebuild of it, with the same content. If anything has
            drifted, correct it here once and every CV you generate picks up the fix.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void runAlign(draft)} disabled={Boolean(aligning) || !hasOriginal}>
            {aligning && <Spinner />}
            Auto-align
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(structuredClone(design))}>
              Discard
            </Button>
          )}
          <Button variant="primary" onClick={save} disabled={!dirty || saving}>
            {saving && <Spinner />}
            {dirty ? 'Save design' : 'Saved'}
          </Button>
        </div>
      </div>

      {(aligning || alignNote) && (
        <Panel className="mt-4 flex items-center gap-2 px-3 py-2 text-sm">
          {aligning ? (
            <>
              <Spinner /> {aligning}
            </>
          ) : (
            <span className="text-subtle">{alignNote}</span>
          )}
        </Panel>
      )}

      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="flex rounded-md border border-line p-0.5 text-sm">
              {(
                [
                  ['overlay', 'Overlay'],
                  ['side', 'Side by side'],
                  ['rebuilt', 'Rebuilt only'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  disabled={!hasOriginal && key !== 'rebuilt'}
                  onClick={() => setView(key)}
                  className={cx(
                    'rounded px-2.5 py-1 transition-colors disabled:opacity-40',
                    effectiveView === key ? 'bg-foreground/10 font-medium' : 'text-subtle',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {effectiveView === 'overlay' && (
              <label className="flex items-center gap-2 text-xs text-subtle">
                Original
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={opacity}
                  onChange={(e) => setOpacity(e.target.valueAsNumber)}
                />
                {Math.round(opacity * 100)}%
              </label>
            )}
          </div>

          {!hasOriginal && (
            <Panel className="mb-3 p-3 text-xs text-subtle">
              No render of the original was kept. That happens with DOCX and text uploads, which
              have no fixed layout to compare against, and with CVs uploaded before this feature
              existed. Re-upload the PDF to compare.
            </Panel>
          )}

          {effectiveView === 'overlay' && (
            <p className="mb-3 text-xs text-subtle">
              Where the two line up, text looks crisp. Doubled or blurred text marks drift: check
              sizes and spacing in that area.
            </p>
          )}

          <div className="rounded-lg bg-foreground/5 p-5">
            {effectiveView === 'side' ? (
              <div className="grid gap-4 xl:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-medium text-subtle">Original</p>
                  <div className="space-y-3">
                    {pageSrcs.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element -- raw render from our own API.
                      <img
                        key={src}
                        src={src}
                        alt={`Original page ${i + 1}`}
                        className="w-full bg-white shadow"
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-subtle">Rebuilt</p>
                  <CvPreview design={draft} data={originalDocument} targetPages={source?.pageCount} />
                </div>
              </div>
            ) : (
              <CvPreview
                design={draft}
                data={originalDocument}
                targetPages={source?.pageCount}
                overlay={effectiveView === 'overlay' ? { srcs: pageSrcs, opacity } : undefined}
              />
            )}
          </div>
        </div>

        <div className="min-w-0">
          <DesignEditor design={draft} onChange={setDraft} />
          <p className="mt-3 text-xs text-subtle">
            Changes apply to every CV, including ones already generated. Content is never
            affected.
          </p>
        </div>
      </div>
    </div>
  );
}
