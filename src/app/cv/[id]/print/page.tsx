'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import CvPreview from '@/components/cv/CvPreview';
import { ErrorNote, Spinner } from '@/components/ui/kit';
import { api } from '@/lib/client-api';
import type { CvDocumentData, DesignSpec } from '@/types/cv';

/**
 * A bare page containing nothing but the document, so the browser's own
 * print-to-PDF produces a clean, text-selectable, vector PDF at exact page size.
 */
export default function PrintPage() {
  const { id } = useParams<{ id: string }>();
  const [design, setDesign] = useState<DesignSpec | null>(null);
  const [data, setData] = useState<CvDocumentData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getCv(id);
        if (cancelled) return;
        setDesign(res.design);
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

  useEffect(() => {
    if (!design || !data) return;
    // Printing before the webfonts land would reflow the document mid-capture.
    let cancelled = false;
    const go = async () => {
      try {
        await document.fonts?.ready;
      } catch {
        // Font loading API is unavailable; the fallback stack is already applied.
      }
      // One extra frame so the final layout has been painted.
      requestAnimationFrame(() => {
        if (!cancelled) window.print();
      });
    };
    void go();
    return () => {
      cancelled = true;
    };
  }, [design, data]);

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
      <CvPreview design={design} data={data} />
    </div>
  );
}
