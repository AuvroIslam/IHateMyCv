'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { googleFontsUrl } from '@/lib/fonts';
import type { CvDocumentData, DesignSpec } from '@/types/cv';
import CvDocument, { pageDimensions } from './CvDocument';

const MM_TO_PX = 96 / 25.4;

/**
 * Wraps the CV document with everything the on-screen view needs and the
 * printed page must not have: fit-to-width scaling, page-break guides, and the
 * webfonts the design depends on.
 */
export default function CvPreview({
  design,
  data,
  className,
  targetPages,
  overlay,
}: {
  design: DesignSpec;
  data: CvDocumentData;
  className?: string;
  /** Page count of the original CV; the warning fires only when this is exceeded. */
  targetPages?: number;
  /** Renders of the original pages laid over the sheet, to expose drift. */
  overlay?: { srcs: string[]; opacity: number };
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [sheetHeight, setSheetHeight] = useState(0);

  const page = pageDimensions(design);
  const sheetWidthPx = page.width * MM_TO_PX;
  const pageHeightPx = page.height * MM_TO_PX;
  const fontsHref = googleFontsUrl(design.font.bodyFamily, design.font.headingFamily);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const fit = () => setScale(Math.min(1, wrapper.clientWidth / sheetWidthPx));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [sheetWidthPx]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const measure = () => setSheetHeight(sheet.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    // Webfonts land after first paint and change how much text fits.
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [design, data]);

  const pageCount = sheetHeight ? Math.max(1, Math.ceil(sheetHeight / pageHeightPx - 0.02)) : 1;
  const guides = Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => (i + 1) * pageHeightPx);

  return (
    <div className={className}>
      {fontsHref && <link rel="stylesheet" href={fontsHref} />}
      <style>{`@page { size: ${design.page.size === 'letter' ? 'Letter' : 'A4'}; margin: 0; }`}</style>

      <div ref={wrapperRef} className="print-surface w-full">
        <div
          className="cv-scaler relative"
          style={{
            width: sheetWidthPx,
            height: sheetHeight ? sheetHeight * scale : undefined,
            transform: `scale(${scale})`,
          }}
        >
          <div ref={sheetRef} className="cv-sheet relative">
            <CvDocument design={design} data={data} />
            {overlay &&
              overlay.srcs.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- a raw render served from our own API, sized in page units; next/image adds nothing here.
                <img
                  key={src}
                  src={src}
                  alt={`Original page ${i + 1}`}
                  className="no-print pointer-events-none absolute left-0"
                  style={{
                    top: i * pageHeightPx,
                    width: sheetWidthPx,
                    height: pageHeightPx,
                    opacity: overlay.opacity,
                    mixBlendMode: 'multiply',
                  }}
                />
              ))}
            {guides.map((top) => (
              <div
                key={top}
                className="no-print pointer-events-none absolute right-0 left-0 border-t border-dashed border-red-400/70"
                style={{ top }}
              >
                <span className="absolute -top-2.5 right-1 bg-red-400/90 px-1 text-[9px] font-medium text-white">
                  page break
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {pageCount > (targetPages ?? 1) && (
        <p className="no-print mt-3 text-xs text-amber-700 dark:text-amber-400">
          This CV runs to {pageCount} pages
          {targetPages ? `; your original was ${targetPages}` : ''}. Drop an entry or a few
          bullets to pull it back.
        </p>
      )}
    </div>
  );
}
