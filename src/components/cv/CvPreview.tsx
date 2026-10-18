'use client';

import { type CSSProperties, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { blockLook, freeLines, hasStyle, styleCss, styledDesign } from '@/lib/cv-style';
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
import {
  ABSORBED,
  ReplicaBlock,
  ReplicaPage,
  type ReplicaSource,
  mapBands,
  replicaFontCss,
  replicaLinks,
  sameContent,
} from './Replica';

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
  design: baseDesign,
  data: givenData,
  className,
  targetPages,
  overlay,
  onPaginated,
  replica,
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
  /**
   * The original PDF, redrawn exactly: shown instead of the rebuild while the
   * CV still says what the original said, and for each block an edit left
   * alone (see Replica.tsx).
   */
  replica?: { source: ReplicaSource | null; original: CvDocumentData | null };
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fullRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pages, setPages] = useState<PageSet[] | null>(null);
  const scope = useId();
  // The CV's own look over the shared design (see cv-style.ts).
  const data = useMemo(() => freeLines(givenData), [givenData]);
  const design = useMemo(() => styledDesign(baseDesign, data.style), [baseDesign, data.style]);

  const replicaSource = replica?.source ?? null;
  const replicaOriginal = replica?.original ?? null;
  const exact = useMemo(
    () =>
      replicaSource && replicaOriginal && !hasStyle(data.style) && sameContent(data, replicaOriginal)
        ? replicaSource
        : null,
    [replicaSource, replicaOriginal, data],
  );
  const exactRef = useRef(exact);
  useEffect(() => {
    exactRef.current = exact;
  });

  const page = pageDimensions(design);
  // The replica keeps the original's own page size, whatever the design says.
  const sheetWidthPx = exact ? exact.layout.pages[0].width * PX_PER_PT : page.width * MM_TO_PX;
  const pageHeightPx = page.height * MM_TO_PX;
  const bodyHeightPx = contentHeightMm(design) * MM_TO_PX;
  const stylesheets = fontStylesheets(design.font.bodyFamily, design.font.headingFamily);

  const twoCol = isTwoColumn(design, data);
  // Unchanged blocks of an edited CV, redrawn from the original. Single-column
  // only: a column band of the PDF would also hold the other column's text.
  const bands = useMemo(() => {
    const source = replicaSource;
    const original = replicaOriginal;
    if (exact || !source || !original || isTwoColumn(baseDesign, original)) return null;
    // As the original printed: the shared design, no colours of this CV's own.
    const originals = buildBlocks(baseDesign, original);
    const found = mapBands(source, originals, baseDesign.sectionHeading.style);
    const bySig = new Map<string, NonNullable<(typeof found)[number]>>();
    // An absorbed block is drawn by the one it follows, so it counts only if that one is drawn.
    found.forEach((band, i) => {
      if (band === ABSORBED && !found[i - 1]) found[i] = null;
    });
    originals.forEach((b, i) => {
      const band = found[i];
      if (band) bySig.set(JSON.stringify(b.content) + blockLook(baseDesign, undefined, b), band);
    });
    return { source, bySig, hrefs: replicaLinks(source, original) };
  }, [exact, replicaSource, replicaOriginal, baseDesign]);
  const blocks = useMemo(() => {
    const built = buildBlocks(design, data);
    if (!bands || twoCol) return built;
    // A block matches only if it says and looks as it did: recoloured blocks are rebuilt.
    const found = built.map((b) => bands.bySig.get(JSON.stringify(b.content) + blockLook(design, data.style, b)));
    return built.map((b, i) => {
      const band = found[i];
      if (!band) return b;
      if (band === ABSORBED) {
        // Only alongside the block that draws it; alone it is rebuilt.
        return found[i - 1] ? { ...b, node: null } : b;
      }
      return {
        ...b,
        node: (
          <ReplicaBlock
            source={bands.source}
            band={band}
            design={baseDesign}
            hrefs={bands.hrefs}
          />
        ),
      };
    });
  }, [design, baseDesign, data, bands, twoCol]);
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
      if (!exactRef.current) onPaginatedRef.current?.(next.length);
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

  useEffect(() => {
    if (exact) onPaginatedRef.current?.(exact.layout.pages.length);
  }, [exact]);

  // Pages are measured after render, so for one render after an edit they can
  // still describe the old blocks. Pages that do not fit the current blocks
  // wait for the next measurement rather than point past the end.
  const fresh = pages?.every((p) => [...p.full, ...p.main, ...p.side].every((i) => i < blocks.length));
  const shown: PageSet[] =
    pages && fresh ? pages : [{ full: indexOf.full, main: indexOf.main, side: indexOf.side }];
  const pageCount = shown.length;
  const stackHeight = pageCount * pageHeightPx + (pageCount - 1) * PAGE_GAP_PX;

  const block = (i: number) => (
    <div key={blocks[i].key} className="cv-block" data-block={blocks[i].key} data-section={blocks[i].section}>
      {blocks[i].node}
    </div>
  );
  const measureBlocks = (indices: number[]) =>
    indices.map((i) => (
      <div key={blocks[i].key} className="cv-block" data-section={blocks[i].section}>
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
    <div className={className} data-cv-root={scope.replace(/[^\w-]/g, '')}>
      {stylesheets.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      <style>{`${exact ? '' : `@page { size: ${design.page.size === 'letter' ? 'Letter' : 'A4'}; margin: 0; }\n`}${embeddedFontCss(design)}${
        bands ? `\n${replicaFontCss(bands.source)}` : ''
      }\n${styleCss(data.style, scope)}`}</style>

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

      {exact ? (
        <ExactPages wrapperRef={wrapperRef} source={exact} scale={scale} design={design} data={data} overlay={overlay} />
      ) : (
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
      )}

      {!exact && pageCount > (targetPages ?? 1) && (
        <p className="no-print mt-3 text-xs text-amber-700 dark:text-amber-400">
          This CV runs to {pageCount} pages
          {targetPages ? `; the CV it started from had ${targetPages}` : ''}. Drop an entry or a few
          bullets to pull it back.
        </p>
      )}
    </div>
  );
}

/** The original's pages, redrawn by the replica, in the same sheets and scaler the rebuild uses. */
function ExactPages({
  wrapperRef,
  source,
  scale,
  design,
  data,
  overlay,
}: {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  source: ReplicaSource;
  scale: number;
  design: DesignSpec;
  data: CvDocumentData;
  overlay?: { srcs: string[]; opacity: number };
}) {
  const pages = source.layout.pages;
  const first = pages[0];
  const hrefs = useMemo(() => replicaLinks(source, data), [source, data]);
  const stackHeight = pages.reduce((h, p) => h + p.height * PX_PER_PT, 0) + (pages.length - 1) * PAGE_GAP_PX;
  return (
    <>
      <style>{`@page { size: ${first.width}pt ${first.height}pt; margin: 0; }
${replicaFontCss(source)}`}</style>
      <div ref={wrapperRef} className="print-surface w-full">
        <div
          className="cv-scaler relative"
          style={{ width: first.width * PX_PER_PT, height: stackHeight * scale, transform: `scale(${scale})` }}
        >
          {pages.map((p, i) => (
            <div
              key={i}
              className="cv-page cv-sheet relative"
              data-replica
              style={{
                width: `${p.width}pt`,
                height: `${p.height}pt`,
                background: '#ffffff',
                marginBottom: i < pages.length - 1 ? PAGE_GAP_PX : 0,
              }}
            >
              <ReplicaPage source={source} index={i} design={design} hrefs={hrefs} />
              {overlay?.srcs[i] && (
                // eslint-disable-next-line @next/next/no-img-element -- a raw render served from our own API.
                <img
                  src={overlay.srcs[i]}
                  alt={`Original page ${i + 1}`}
                  className="no-print pointer-events-none absolute top-0 left-0"
                  style={{ width: '100%', height: '100%', opacity: overlay.opacity, mixBlendMode: 'multiply' }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
