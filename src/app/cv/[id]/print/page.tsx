'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import CvPreview from '@/components/cv/CvPreview';
import { backgroundUrl, useReplicaSource } from '@/components/cv/Replica';
import { ErrorNote, Spinner } from '@/components/ui/kit';
import { api } from '@/lib/client-api';
import type { CvDocumentData, DesignSpec, SourceMeta } from '@/types/cv';

/**
 * A bare page containing nothing but the document, so the browser's own
 * print-to-PDF produces a clean, text-selectable, vector PDF at exact page size.
 */
export default function PrintPage() {
  const { id } = useParams<{ id: string }>();
  const [design, setDesign] = useState<DesignSpec | null>(null);
  const [data, setData] = useState<CvDocumentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [laidOut, setLaidOut] = useState(false);
  const { originalDocument, source: appSource } = useApp();
  const [loaded, setLoaded] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  // The design's own upload: the original, or the template this CV follows.
  const [template, setTemplate] = useState<{ id: string; source: SourceMeta; original: CvDocumentData } | null>(null);
  const replica = useReplicaSource(template);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getCv(id);
        if (cancelled) return;
        setDesign(res.design);
        setTemplate(res.template);
        setLoaded(true);
        setData(res.cv.data);
        document.title = res.cv.name || 'CV';
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this CV.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // A CV with an exact copy prints the copy: wait for it (a few seconds at
  // most - past that, the rebuild prints rather than nothing).
  const expectsReplica = loaded && ((template ? template.source : appSource)?.backgrounds ?? 0) > 0;
  useEffect(() => {
    if (!expectsReplica || replica) return;
    const t = setTimeout(() => setGaveUp(true), 6000);
    return () => clearTimeout(t);
  }, [expectsReplica, replica]);

  useEffect(() => {
    if (!design || !data || !laidOut || (expectsReplica && !replica && !gaveUp)) return;
    // Printing before the webfonts land would reflow the document mid-capture,
    // and pages are only final once measured with those fonts.
    let cancelled = false;
    const go = async () => {
      try {
        await document.fonts?.ready;
      } catch {
        // Font loading API is unavailable; the fallback stack is already applied.
      }
      // The copy's page backgrounds must be drawn before the capture.
      if (replica) {
        await Promise.all(
          replica.layout.pages.map(
            (_, i) =>
              new Promise<void>((done) => {
                const img = new Image();
                img.onload = img.onerror = () => done();
                img.src = backgroundUrl(replica, i);
              }),
          ),
        );
      }
      // Two frames: one for pagination to settle after the fonts, one to paint.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!cancelled) window.print();
        }),
      );
    };
    void go();
    return () => {
      cancelled = true;
    };
  }, [design, data, laidOut, expectsReplica, replica, gaveUp]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorNote>{error}</ErrorNote>
      </div>
    );
  }

  if (!design || !data) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-subtle">
        <Spinner className="mr-2" /> Preparing your PDF…
      </div>
    );
  }

  return (
    <div className="print-surface bg-white p-0">
      <p className="no-print border-b border-line bg-background p-3 text-center text-xs text-subtle">
        Your browser&apos;s print dialog should have opened. Choose &ldquo;Save as PDF&rdquo;, and set
        margins to <strong>None</strong> — the page margins are already part of the design.
      </p>
      <CvPreview
        design={design}
        data={data}
        replica={{ source: replica, original: template ? template.original : originalDocument }}
        onPaginated={() => setLaidOut(true)}
      />
    </div>
  );
}
