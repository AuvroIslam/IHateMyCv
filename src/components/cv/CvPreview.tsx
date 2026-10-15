'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { embeddedFontCss } from '@/lib/embedded-fonts';
import { fontStylesheets } from '@/lib/fonts';
import type { CvDocumentData, DesignSpec } from '@/types/cv';
import CvDocument, {
  buildBlocks,
  canPaginate,
  contentHeightMm,
  contentWidthMm,
  pageDimensions,
  pageStyle,
  textStyle,
} from './CvDocument';

const MM_TO_PX = 96 / 25.4;
/** Gap between pages on screen, before scaling. Not printed. */
const PAGE_GAP_PX = 24;

/**
 * Deals measured block heights onto pages. A block never splits; a heading
 * never ends a page, so it always travels with its first entry.
 */
export function packPages(heights: number[], keepWithNext: boolean[], pageHeight: number): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;
  for (let i = 0; i < heights.length; i++) {
    const needed = keepWithNext[i] && i + 1 < heights.length ? heights[i] + heights[i + 1] : heights[i];
    if (current.length > 0 && used + needed > pageHeight) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(i);
    used += heights[i];
  }
  if (current.length) pages.push(current);
  return pages;
}

/**
 * Wraps the CV with what the on-screen view needs and the printed page must
 * not have: fit-to-width scaling, page gaps, and the webfonts the design
 * depends on. The same page elements are what gets printed.
 */
export default function CvPreview({
  design,
  data,
  className,
  targetPages,
  overlay,
  onPaginated,
}: {
  design: DesignSpec;
  data: CvDocumentData;
  className?: string;
  /** Page count of the original CV; the warning fires only when this is exceeded. */
  targetPages?: number;
  /** Renders of the original pages laid over the sheets, to expose drift. */
  overlay?: { srcs: string[]; opacity: number };
  /** Fires once pages are laid out, so printing can wait for it. */
  onPaginated?: (pageCount: number) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pages, setPages] = useState<number[][] | null>(null);
  const [sheetHeight, setSheetHeight] = useState(0);

  const page = pageDimensions(design);
  const sheetWidthPx = page.width * MM_TO_PX;
  const pageHeightPx = page.height * MM_TO_PX;
  const bodyHeightPx = contentHeightMm(design) * MM_TO_PX;
  const stylesheets = fontStylesheets(design.font.bodyFamily, design.font.headingFamily);

  const paginated = canPaginate(design, data);
  const blocks = useMemo(() => (paginated ? buildBlocks(design, data) : []), [paginated, design, data]);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const fit = () => setScale(Math.min(1, wrapper.clientWidth / sheetWidthPx));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [sheetWidthPx]);

  // Measure every block in an unbroken flow at the real content width, then
  // deal them onto pages. Re-runs when webfonts land, since they change how
  // much fits on a line.
  const onPaginatedRef = useRef(onPaginated);
  useEffect(() => {
    onPaginatedRef.current = onPaginated;
  });

  useLayoutEffect(() => {
    const flow = flowRef.current;
    if (!paginated || !flow) return;
    const measure = () => {
      const els = Array.from(flow.children) as HTMLElement[];
      if (!els.length || flow.offsetHeight === 0) return;
      const tops = els.map((el) => el.offsetTop);
      const heights = els.map((_, i) => (i + 1 < els.length ? tops[i + 1] : flow.scrollHeight) - tops[i]);
      const next = packPages(heights, blocks.map((b) => b.keepWithNext), bodyHeightPx);
      setPages((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      onPaginatedRef.current?.(next.length);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(flow);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [paginated, blocks, bodyHeightPx]);

  // Two-column fallback: one continuous sheet, measured for page guides.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (paginated || !sheet) return;
    const measure = () => {
      setSheetHeight(sheet.offsetHeight);
      onPaginatedRef.current?.(Math.max(1, Math.ceil(sheet.offsetHeight / pageHeightPx - 0.02)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [paginated, design, data, pageHeightPx]);

  const pageCount = paginated
    ? (pages?.length ?? 1)
    : sheetHeight
      ? Math.max(1, Math.ceil(sheetHeight / pageHeightPx - 0.02))
      : 1;

  const stackHeight = paginated
    ? pageCount * pageHeightPx + (pageCount - 1) * PAGE_GAP_PX
    : sheetHeight || pageHeightPx;

  const overlayImg = (src: string, i: number, top: number) => (
    // eslint-disable-next-line @next/next/no-img-element -- a raw render served from our own API, sized in page units; next/image adds nothing here.
    <img
      key={src}
      src={src}
      alt={`Original page ${i + 1}`}
      className="no-print pointer-events-none absolute left-0"
      style={{
        top,
        width: sheetWidthPx,
        height: pageHeightPx,
        opacity: overlay?.opacity,
        mixBlendMode: 'multiply',
      }}
    />
  );

  return (
    <div className={className}>
      {stylesheets.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      <style>{`@page { size: ${design.page.size === 'letter' ? 'Letter' : 'A4'}; margin: 0; }\n${embeddedFontCss(design)}`}</style>

      {paginated && (
        // Off-screen but laid out, including while printing, so measurements
        // never collapse to zero mid-print.
        <div className="cv-measure" aria-hidden>
          <div
            ref={flowRef}
            lang="en"
            style={{ ...textStyle(design), width: `${contentWidthMm(design)}mm`, display: 'flow-root' }}
          >
            {blocks.map((b) => (
              <div key={b.key} className="cv-block">
                {b.node}
              </div>
            ))}
          </div>
        </div>
      )}

      <div ref={wrapperRef} className="print-surface w-full">
        <div
          className="cv-scaler relative"
          style={{ width: sheetWidthPx, height: stackHeight * scale, transform: `scale(${scale})` }}
        >
          {paginated ? (
            (pages ?? [blocks.map((_, i) => i)]).map((indices, p, all) => (
              <div
                key={p}
                className="cv-page cv-sheet relative"
                lang="en"
                style={{ ...pageStyle(design), marginBottom: p < all.length - 1 ? PAGE_GAP_PX : 0 }}
              >
                <div className="cv-page-body" style={{ display: 'flow-root' }}>
                  {indices.map((i) => (
                    <div key={blocks[i].key} className="cv-block">
                      {blocks[i].node}
                    </div>
                  ))}
                </div>
                {overlay?.srcs[p] && overlayImg(overlay.srcs[p], p, 0)}
              </div>
            ))
          ) : (
            <div ref={sheetRef} className="cv-sheet relative">
              <CvDocument design={design} data={data} />
              {overlay?.srcs.map((src, i) => overlayImg(src, i, i * pageHeightPx))}
              {Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => (i + 1) * pageHeightPx).map(
                (top) => (
                  <div
                    key={top}
                    className="no-print pointer-events-none absolute right-0 left-0 border-t border-dashed border-red-400/70"
                    style={{ top }}
                  >
                    <span className="absolute -top-2.5 right-1 bg-red-400/90 px-1 text-[9px] font-medium text-white">
                      page break
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
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
