'use client';

import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { embeddedFontCss } from '@/lib/embedded-fonts';
import { fontStylesheets } from '@/lib/fonts';
import type { CvDocumentData, DesignSpec } from '@/types/cv';
import {
  buildBlocks,
  columnWidthsMm,
  contentHeightMm,
  contentWidthMm,
  isTwoColumn,
  pageDimensions,
  pageStyle,
  textStyle,
} from './CvDocument';

const MM_TO_PX = 96 / 25.4;
const PX_PER_PT = 96 / 72;
/** Gap between pages on screen, before scaling. Not printed. */
const PAGE_GAP_PX = 24;

/**
 * Deals measured blocks onto pages. A block never splits; a heading never
 * ends a page, so it always travels with its first entry.
 *
 * Positions, not heights: a block fits when its content bottom is on the
 * page. Its trailing gap belongs to whatever comes next, and at the foot of a
 * page there is nothing next - counting it would break pages earlier than
 * TeX does. TeX also lets the last line's descenders sit slightly into the
 * margin, hence the small allowance.
 */
export function packPages(
  tops: number[],
  bottoms: number[],
  keepWithNext: boolean[],
  pageHeight: number,
  allowance = 0,
  /** Where page 1's room begins, when something above the flow already uses some of it. */
  firstPageStart?: number,
): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let start = 0;
  for (let i = 0; i < tops.length; i++) {
    if (current.length === 0) start = pages.length === 0 && firstPageStart !== undefined ? firstPageStart : tops[i];
    const lastIndex = keepWithNext[i] && i + 1 < tops.length ? i + 1 : i;
    if (current.length > 0 && bottoms[lastIndex] - start > pageHeight + allowance) {
      pages.push(current);
      current = [];
      start = tops[i];
    }
    current.push(i);
  }
  if (current.length) pages.push(current);
  return pages;
}

/** One printed page: the full-width blocks, then each column's blocks. */
interface PageSet {
  full: number[];
  main: number[];
  side: number[];
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
  const fullRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pages, setPages] = useState<PageSet[] | null>(null);

  const page = pageDimensions(design);
  const sheetWidthPx = page.width * MM_TO_PX;
  const pageHeightPx = page.height * MM_TO_PX;
  const bodyHeightPx = contentHeightMm(design) * MM_TO_PX;
  const stylesheets = fontStylesheets(design.font.bodyFamily, design.font.headingFamily);

  const blocks = useMemo(() => buildBlocks(design, data), [design, data]);
  const twoCol = isTwoColumn(design, data);
  const widths = columnWidthsMm(design);
  const indexOf = useMemo(() => {
    const by = { full: [] as number[], main: [] as number[], side: [] as number[] };
    blocks.forEach((b, i) => by[b.column].push(i));
    return by;
  }, [blocks]);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const fit = () => setScale(Math.min(1, wrapper.clientWidth / sheetWidthPx));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [sheetWidthPx]);

  const onPaginatedRef = useRef(onPaginated);
  useEffect(() => {
    onPaginatedRef.current = onPaginated;
  });

  // Measure every block in unbroken flows at the real widths - one per
  // column - then deal each column onto pages on its own. Re-runs when
  // webfonts land, since they change how much fits on a line.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    // A block's box ends below its last baseline by the descent plus half
    // the leading, and loose line heights (1.5+) make that leading large.
    // TeX only needs the baseline on the page, so allow for both.
    const halfLeading = Math.max(0, design.font.lineHeight - 1.2) / 2;
    const allowance = design.font.baseSizePt * (0.3 + halfLeading) * PX_PER_PT;
    const packFlow = (flow: HTMLDivElement | null, indices: number[], firstHeight: number) => {
      if (!flow || !indices.length) return [] as number[][];
      const els = Array.from(flow.children) as HTMLElement[];
      // Page 1 is shorter by whatever spans above the columns: start the
      // flow that much further down so the packer sees less room there.
      const shift = bodyHeightPx - firstHeight;
      const tops = els.map((el) => el.offsetTop + shift);
      // A block's own box excludes its trailing margin, which collapses out of it.
      const bottoms = els.map((el) => el.offsetTop + el.offsetHeight + shift);
      const keep = indices.map((i) => blocks[i].keepWithNext);
      return packPages(tops, bottoms, keep, bodyHeightPx, allowance, 0).map((pageIdx) =>
        pageIdx.map((k) => indices[k]),
      );
    };
    const measure = () => {
      if (main.offsetHeight === 0 && indexOf.main.length) return;
      const headerHeight = twoCol ? (fullRef.current?.scrollHeight ?? 0) : 0;
      const mainPages = packFlow(main, indexOf.main, bodyHeightPx - headerHeight);
      const sidePages = twoCol ? packFlow(sideRef.current, indexOf.side, bodyHeightPx - headerHeight) : [];
      const count = Math.max(1, mainPages.length, sidePages.length);
      const next: PageSet[] = Array.from({ length: count }, (_, p) => ({
        full: p === 0 ? indexOf.full : [],
        main: mainPages[p] ?? [],
        side: sidePages[p] ?? [],
      }));
      setPages((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      onPaginatedRef.current?.(next.length);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    if (sideRef.current) observer.observe(sideRef.current);
    if (fullRef.current) observer.observe(fullRef.current);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [blocks, indexOf, twoCol, bodyHeightPx, design.font.baseSizePt, design.font.lineHeight]);

  // Lines locked to the original's breaks: where TeX squeezed word spaces
  // tighter than CSS justification ever will, the line overflows by a point
  // or two. Tighten just that line's word spacing until it fits.
  useLayoutEffect(() => {
    const root = wrapperRef.current;
    if (!root) return;
    const fit = () => {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('.cv-line'))) {
        el.style.wordSpacing = '';
        const over = el.scrollWidth - el.clientWidth;
        if (over <= 0.5) continue;
        const spaces = (el.textContent?.match(/ /g) ?? []).length;
        // Relative to the design's own word spacing, which this replaces.
        // Spaces give up at most about half their width (0.12em): beyond that
        // words run together, and a slight overhang reads far better.
        const cs = getComputedStyle(el);
        const base = parseFloat(cs.wordSpacing) || 0;
        const floor = base - 0.12 * (parseFloat(cs.fontSize) || 12);
        if (spaces) el.style.wordSpacing = `${Math.max(floor, base - (over + 0.5) / spaces)}px`;
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
  }, [pages, blocks, design, data]);

  // Pages are measured after render, so for one render after an edit they can
  // still describe the old blocks. Pages that do not fit the current blocks
  // wait for the next measurement rather than point past the end.
  const fresh = pages?.every((p) => [...p.full, ...p.main, ...p.side].every((i) => i < blocks.length));
  const shown: PageSet[] =
    pages && fresh ? pages : [{ full: indexOf.full, main: indexOf.main, side: indexOf.side }];
  const pageCount = shown.length;
  const stackHeight = pageCount * pageHeightPx + (pageCount - 1) * PAGE_GAP_PX;

  const block = (i: number) => (
    <div key={blocks[i].key} className="cv-block" data-block={blocks[i].key}>
      {blocks[i].node}
    </div>
  );
  const measureBlocks = (indices: number[]) =>
    indices.map((i) => (
      <div key={blocks[i].key} className="cv-block">
        {blocks[i].node}
      </div>
    ));
  // position: relative makes each flow its blocks' offsetParent, so offsetTop
  // is measured within that column, not from the shared measuring container
  // (where the side column would sit below the whole main column).
  const flowStyle = (widthMm: number): CSSProperties => ({
    ...textStyle(design),
    width: `${widthMm}mm`,
    display: 'flow-root',
    position: 'relative',
  });
  const overlayImg = (src: string, i: number) => (
    // eslint-disable-next-line @next/next/no-img-element -- a raw render served from our own API, sized in page units; next/image adds nothing here.
    <img
      key={src}
      src={src}
      alt={`Original page ${i + 1}`}
      className="no-print pointer-events-none absolute top-0 left-0"
      style={{ width: sheetWidthPx, height: pageHeightPx, opacity: overlay?.opacity, mixBlendMode: 'multiply' }}
    />
  );

  return (
    <div className={className}>
      {stylesheets.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      <style>{`@page { size: ${design.page.size === 'letter' ? 'Letter' : 'A4'}; margin: 0; }\n${embeddedFontCss(design)}`}</style>

      {/* Off-screen but laid out, even while printing, so measurements never collapse to zero mid-print. */}
      <div className="cv-measure" aria-hidden>
        {twoCol && (
          <div ref={fullRef} lang="en" style={flowStyle(contentWidthMm(design))}>
            {measureBlocks(indexOf.full)}
          </div>
        )}
        <div ref={mainRef} lang="en" style={flowStyle(twoCol ? widths.main : contentWidthMm(design))}>
          {measureBlocks(indexOf.main)}
        </div>
        {twoCol && (
          <div ref={sideRef} lang="en" style={flowStyle(widths.side)}>
            {measureBlocks(indexOf.side)}
          </div>
        )}
      </div>

      <div ref={wrapperRef} className="print-surface w-full">
        <div
          className="cv-scaler relative"
          style={{ width: sheetWidthPx, height: stackHeight * scale, transform: `scale(${scale})` }}
        >
          {shown.map((set, p) => {
            const sideCol = (
              <div className="cv-col" style={{ width: `${widths.side}mm`, flexShrink: 0, display: 'flow-root' }}>
                {set.side.map(block)}
              </div>
            );
            return (
              <div
                key={p}
                className="cv-page cv-sheet relative"
                lang="en"
                style={{ ...pageStyle(design), marginBottom: p < pageCount - 1 ? PAGE_GAP_PX : 0 }}
              >
                <div className="cv-page-body" style={{ display: 'flow-root' }}>
                  {set.full.map(block)}
                  {twoCol ? (
                    <div style={{ display: 'flex', gap: `${widths.gap}mm`, alignItems: 'flex-start' }}>
                      {design.layout.sideColumn === 'left' && sideCol}
                      <div className="cv-col" style={{ flex: 1, minWidth: 0, display: 'flow-root' }}>
                        {set.main.map(block)}
                      </div>
                      {design.layout.sideColumn === 'right' && sideCol}
                    </div>
                  ) : (
                    set.main.map(block)
                  )}
                </div>
                {overlay?.srcs[p] && overlayImg(overlay.srcs[p], p)}
              </div>
            );
          })}
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
