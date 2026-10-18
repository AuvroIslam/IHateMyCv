'use client';

import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { api } from '@/lib/client-api';
import { fontStack } from '@/lib/fonts';
import type { CvDocumentData, DesignSpec, SourceLayout } from '@/types/cv';

/**
 * The exact replica: the original PDF's own text, drawn where the PDF drew
 * it - every run at its baseline, in its embedded font, size and colour, and
 * stretched to its measured width - over the original page with its text
 * erased (rules, icons, photos and coloured blocks). This is the approach of
 * pdf2htmlEX and of design tools that import PDFs; it reproduces the page
 * rather than re-laying it out.
 *
 * A CV that still says what the original said is redrawn page by page. An
 * edited one is rebuilt, except for the blocks the edit left alone: those are
 * redrawn from their band of the original page (see mapBands).
 */

export interface ReplicaSource {
  layout: SourceLayout;
  /** Changes on each upload, so cached backgrounds and fonts are never stale. */
  version: string;
  /** Pages with a background; the replica needs one per page. */
  backgrounds: number;
}

/** The replica's inputs for the current upload, once loaded; null when this upload has none. */
export function useReplicaSource(): ReplicaSource | null {
  const { source } = useApp();
  const [layout, setLayout] = useState<{ version: string; layout: SourceLayout } | null>(null);
  const version = source?.uploadedAt ?? '';
  const backgrounds = source?.backgrounds ?? 0;
  useEffect(() => {
    if (!backgrounds) return;
    let cancelled = false;
    api
      .getSourceLayout()
      .then((r) => !cancelled && setLayout({ version, layout: r.layout }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [version, backgrounds]);
  return useMemo(() => {
    if (!backgrounds || !layout || layout.version !== version) return null;
    if (!layout.layout.pages.length || layout.layout.pages.length > backgrounds) return null;
    return { layout: layout.layout, version, backgrounds };
  }, [layout, version, backgrounds]);
}

const faceFamily = (id: string) => `cv-face-${id}`;
const MM_TO_PT = 72 / 25.4;

/** One @font-face per embedded font the replica's runs use. */
export function replicaFontCss(source: ReplicaSource): string {
  const ids = new Set<string>();
  for (const p of source.layout.pages) for (const l of p.lines) for (const r of l.runs) if (r.face) ids.add(r.face);
  return [...ids]
    .map(
      (id) =>
        // Each face is a family of its own, weight-agnostic: the file already is
        // the bold or italic cut, and the browser must not embolden it again.
        `@font-face { font-family: "${faceFamily(id)}"; font-weight: 1 1000; font-style: normal; ` +
        `font-display: block; src: url("/api/source/fonts/${id}?v=${encodeURIComponent(source.version)}"); }`,
    )
    .join('\n');
}

/** What a CV says, ignoring how it was printed: the replica applies while this matches the original's. */
function contentOf(data: CvDocumentData) {
  const p = data.personal;
  return {
    personal: [p.fullName, p.headline ?? null, p.email ?? null, p.phone ?? null, p.location ?? null, p.links.map((l) => [l.label, l.value])],
    sections: data.sections
      .filter((s) => !s.hidden)
      .map((s) => ({
        id: s.sectionId,
        title: s.title ?? null,
        summary: s.summary?.trim() ?? null,
        entries: s.entries.map((e) => ({
          title: e.title,
          subtitle: e.subtitle ?? null,
          location: e.location ?? null,
          date: e.dateText ?? null,
          note: e.note ?? null,
          group: e.group ?? null,
          links: (e.links ?? []).map((l) => [l.label, l.url]),
          bullets: e.bullets,
        })),
        skills: s.skillGroups.map((g) => [g.category, g.skills]),
      })),
  };
}

export function sameContent(a: CvDocumentData, b: CvDocumentData): boolean {
  return JSON.stringify(contentOf(a)) === JSON.stringify(contentOf(b));
}

type SourceLine = SourceLayout['pages'][number]['lines'][number];

/**
 * Link targets for the replica's text, by run, in reading order: the
 * original printed "Github" under every project, so each occurrence takes
 * the next project's URL.
 */
export function replicaLinks(source: ReplicaSource, data: CvDocumentData): Map<string, string> {
  const q = new Map<string, string[]>();
  const add = (label: string | undefined, href: string | undefined) => {
    if (!label?.trim() || !href) return;
    const key = label.trim().toLowerCase();
    q.set(key, [...(q.get(key) ?? []), href]);
  };
  const p = data.personal;
  if (p.email) add(p.email, `mailto:${p.email}`);
  for (const l of p.links) add(l.label, l.href);
  for (const s of data.sections) for (const e of s.entries) for (const l of e.links ?? []) add(l.label, l.url);
  const hrefs = new Map<string, string>();
  source.layout.pages.forEach((page, pi) =>
    page.lines.forEach((line, li) =>
      line.runs.forEach((run, ri) => {
        const href = q.get(run.text.trim().toLowerCase())?.shift();
        if (href) hrefs.set(`${pi}-${li}-${ri}`, href);
      }),
    ),
  );
  return hrefs;
}

const lineTop = (l: SourceLine) => Math.min(...l.runs.map((r) => (r.y ?? l.y) - 0.95 * (r.size ?? l.size)));
const lineBottom = (l: SourceLine) => Math.max(...l.runs.map((r) => (r.y ?? l.y) + 0.3 * (r.size ?? l.size)));

/** The text and drawing of one page between two heights, in page points. */
function ReplicaSvg({
  source,
  index,
  top,
  bottom,
  hrefs,
  fallback,
  style,
}: {
  source: ReplicaSource;
  index: number;
  top: number;
  bottom: number;
  hrefs: Map<string, string>;
  fallback: string;
  style: CSSProperties;
}) {
  const page = source.layout.pages[index];
  return (
    <svg viewBox={`0 ${top} ${page.width} ${bottom - top}`} preserveAspectRatio="none" style={style}>
      <image
        href={`/api/source/backgrounds/${index + 1}?v=${encodeURIComponent(source.version)}`}
        x={0}
        y={0}
        width={page.width}
        height={page.height}
        preserveAspectRatio="none"
      />
      {page.lines.flatMap((line, li) => {
        if (line.y < top || line.y > bottom) return [];
        return line.runs.map((run, ri) => {
          if (run.drawn || !run.text.trim()) return null; // drawn bullets are in the background
          const width = run.xEnd - run.x;
          const key = `${index}-${li}-${ri}`;
          const text = (
            <text
              key={key}
              x={run.x}
              y={run.y ?? line.y}
              fontSize={run.size ?? line.size}
              fontFamily={run.face ? `"${faceFamily(run.face)}", ${fallback}` : fallback}
              fontWeight={run.face ? undefined : run.bold ? 700 : 400}
              fontStyle={run.face ? undefined : run.italic ? 'italic' : 'normal'}
              fill={run.color ?? '#000000'}
              xmlSpace="preserve"
              {...(width > 0.5 ? { textLength: width, lengthAdjust: 'spacingAndGlyphs' } : {})}
            >
              {run.text}
            </text>
          );
          const href = hrefs.get(key);
          return href ? (
            <a key={key} href={href}>
              {text}
            </a>
          ) : (
            text
          );
        });
      })}
    </svg>
  );
}

/** One page of the original, redrawn. Fills its (positioned) page sheet. */
export function ReplicaPage({
  source,
  index,
  design,
  hrefs,
}: {
  source: ReplicaSource;
  index: number;
  design: DesignSpec;
  hrefs: Map<string, string>;
}) {
  const page = source.layout.pages[index];
  return (
    <ReplicaSvg
      source={source}
      index={index}
      top={0}
      bottom={page.height}
      hrefs={hrefs}
      fallback={fontStack(design.font.bodyFamily)}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  );
}

// ---------------------------------------------------------------------------
// Blocks: an edited CV keeps the original's drawing for what it left alone.

/** Where one block of the original printed: a band across one page. */
export interface Band {
  page: number;
  /** Where the row above ends: the space from here to textTop is the gap above the block. */
  top: number;
  textTop: number;
  bottom: number;
  /** Where the next row begins: the gap below the block. */
  gapEnd: number;
  /**
   * What the block draws, gaps included: a rule in a gap belongs to the
   * block it sits nearer, so a heading's rule is drawn with the heading and
   * never twice when a neighbour is rebuilt.
   */
  drawTop: number;
  drawBottom: number;
  /** The CV's first block, at the top of page 1: placed where it printed, measured from the top margin. */
  pinned: boolean;
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Link targets: kept in a block's content, but never printed. */
const URL_LIKE = /^(https?:|mailto:|www\.)|^[\w.-]+\.[a-z]{2,}\//i;

function contentWords(content: unknown[]): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string' && !URL_LIKE.test(v.trim())) for (const w of words(v)) out.add(w);
    else if (Array.isArray(v)) v.forEach(walk);
  };
  walk(content);
  return out;
}

/** The share of a line's words that a block prints. */
function coverage(lineWords: string[], bag: Set<string>): number {
  if (!lineWords.length) return 0;
  return lineWords.filter((w) => bag.has(w)).length / lineWords.length;
}

/** A line's words. Runs are pieces of one line, split wherever the PDF moved the pen - often mid-word, to kern. */
function lineWords(line: SourceLine): string[] {
  let text = '';
  let end = -Infinity;
  for (const r of line.runs) {
    if (r.drawn) continue;
    if (text && r.x - end > 0.15 * (r.size ?? line.size)) text += ' ';
    text += r.text;
    end = r.xEnd;
  }
  return words(text);
}

/** A block that prints the same words as the block before it, and is drawn as part of that one's band. */
export const ABSORBED = 'absorbed';

/**
 * Finds each of the original's blocks in its PDF.
 *
 * The page is read as visual rows - lines whose baselines nearly meet, like
 * a title and the date set a little higher beside it - so a band never cuts
 * through one. Blocks and rows are both in reading order: the rows are walked
 * once, each joining the block that prints most of its words. A block's band
 * runs from the bottom of the row before it - taking in the gap, rule or
 * heading space above it - to the bottom of its own last row, so consecutive
 * bands tile the page exactly. A band is kept only if its rows print the
 * block's words too: a block is never redrawn from someone else's text.
 *
 * A block that opened a page had no gap above it there, yet in an edited CV
 * it may land mid-page: it takes the gap usual for its kind of block
 * (heading, entry...) in the rest of the original.
 *
 * Blocks that print the very same words (a skill set split over several
 * blocks) cannot be told apart: the first is drawn with all their rows and
 * the rest are absorbed into it.
 */
export function mapBands(
  source: ReplicaSource,
  blocks: { key: string; content: unknown[] }[],
  /** The design's section heading style: says which side of a heading its rule belongs to. */
  headingStyle?: DesignSpec['sectionHeading']['style'],
): (Band | typeof ABSORBED | null)[] {
  interface Row {
    page: number;
    lines: SourceLine[];
    words: string[];
    top: number;
    bottom: number;
    y: number;
    size: number;
  }
  const rows: Row[] = [];
  source.layout.pages.forEach((page, pi) => {
    for (const line of [...page.lines].sort((x, y) => x.y - y.y)) {
      const w = lineWords(line);
      if (!w.length) continue;
      const last = rows[rows.length - 1];
      if (last && last.page === pi && line.y - last.y < 0.6 * Math.max(last.size, line.size)) {
        last.lines.push(line);
        last.words.push(...w);
        last.top = Math.min(last.top, lineTop(line));
        last.bottom = Math.max(last.bottom, lineBottom(line));
        last.y = line.y;
        last.size = Math.max(last.size, line.size);
      } else {
        rows.push({ page: pi, lines: [line], words: w, top: lineTop(line), bottom: lineBottom(line), y: line.y, size: line.size });
      }
    }
  });

  const bags = blocks.map((b) => contentWords(b.content));
  const keys = bags.map((bag) => [...bag].sort().join(' '));
  // Identical neighbours share the first one's lines.
  const lead = keys.map((_, i) => {
    let j = i;
    while (j > 0 && keys[j - 1] === keys[i]) j--;
    return j;
  });

  const owned: Row[][] = blocks.map(() => []);
  let b = 0;
  for (const r of rows) {
    // Move on to a later block - a few ahead, past any the PDF never printed -
    // that prints more of this row than the current one.
    const here = coverage(r.words, bags[b]);
    for (let k = b + 1; k < Math.min(blocks.length, b + 4); k++) {
      const c = coverage(r.words, bags[k]);
      if (c >= 0.5 && c > here) {
        b = k;
        break;
      }
    }
    if (coverage(r.words, bags[b]) >= 0.5) owned[lead[b]].push(r);
  }

  // Where each gap is cut between the rows either side of it, for drawing:
  // a rule goes with the heading the design draws it for (above or below the
  // heading text), and otherwise with the row it sits nearer.
  const ownerOf = new Map<Row, number>();
  owned.forEach((rs, i) => rs.forEach((r) => ownerOf.set(r, i)));
  const isHeading = (r: Row | undefined) => r !== undefined && blocks[ownerOf.get(r) ?? -1]?.key.endsWith(':heading');
  const ruleAbove = headingStyle === 'rule-before';
  const ruleBelow = headingStyle === 'rule-after' || headingStyle === 'underline';
  const cutAfter = rows.map((r, i) => {
    const next = rows[i + 1];
    if (!next || next.page !== r.page) return r.bottom;
    const rules = (source.layout.pages[r.page].rules ?? []).filter((x) => x.y > r.bottom && x.y < next.top);
    if (!rules.length) return r.bottom;
    const lowest = Math.max(...rules.map((x) => x.y + x.thickness / 2)) + 0.5;
    if (ruleAbove && isHeading(next) && !isHeading(r)) return r.bottom;
    if (ruleBelow && isHeading(r) && !isHeading(next)) return Math.min(lowest, next.top);
    const upper = rules.filter((x) => x.y - r.bottom < next.top - x.y);
    return upper.length ? Math.max(...upper.map((x) => x.y + x.thickness / 2)) + 0.5 : r.bottom;
  });

  const opened = new Set<number>();
  const bands = blocks.map((_, i): Band | typeof ABSORBED | null => {
    if (lead[i] !== i) return ABSORBED;
    const own = owned[i];
    if (!own.length || own.some((r) => r.page !== own[0].page)) return null;
    const printed = new Set(own.flatMap((r) => r.words));
    const bag = [...bags[i]];
    if (!bag.length || bag.filter((w) => printed.has(w)).length / bag.length < 0.9) return null;
    const pageRows = rows.filter((r) => r.page === own[0].page);
    const before = pageRows[pageRows.indexOf(own[0]) - 1];
    const after = pageRows[pageRows.indexOf(own[own.length - 1]) + 1];
    const first = Math.min(...own.map((r) => r.top));
    const bottom = Math.max(...own.map((r) => r.bottom));
    const last = own[own.length - 1];
    if (!before) opened.add(i);
    return {
      page: own[0].page,
      top: before ? Math.min(before.bottom, first) : 0,
      textTop: first,
      bottom,
      gapEnd: after ? Math.max(bottom, after.top) : bottom,
      drawTop: before ? Math.min(cutAfter[rows.indexOf(before)], first) : 0,
      drawBottom: after ? Math.max(bottom, cutAfter[rows.indexOf(last)]) : bottom,
      pinned: !before && i === 0 && own[0].page === 0,
    };
  });

  const kind = (key: string) => key.replace(/^[^:]*:?/, '').replace(/:.*$/, '').replace(/^(?!heading|summary|skills|group).*$/, 'entry');
  const gaps = new Map<string, number[]>();
  bands.forEach((band, i) => {
    if (!band || band === ABSORBED || opened.has(i)) return;
    const k = kind(blocks[i].key);
    gaps.set(k, [...(gaps.get(k) ?? []), band.textTop - band.top]);
  });
  const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const all = [...gaps.values()].flat();
  for (const i of opened) {
    const band = bands[i];
    if (!band || band === ABSORBED || band.pinned) continue;
    const same = gaps.get(kind(blocks[i].key));
    const gap = same?.length ? median(same) : all.length ? median(all) : 0;
    band.top = Math.max(0, band.textTop - gap);
    // Still draws any rule set above it on its page (a heading's rule).
    const rules = (source.layout.pages[band.page].rules ?? []).filter((x) => x.y < band.textTop && band.textTop - x.y < 2 * gap + 6);
    band.drawTop = Math.min(band.top, ...rules.map((x) => x.y - x.thickness / 2 - 0.5));
  }
  return bands;
}

/**
 * A block redrawn from the original: its text as tall in the flow as it was
 * on the page, shifted left by the page margin so the page's x positions land
 * where they printed. The gaps above and below are margins, so they collapse
 * like the rebuild's own: two neighbouring bands of the original meet exactly
 * as they printed, and next to a rebuilt block the larger gap wins rather than
 * both. The drawing runs on into those margins as far as its own share of
 * each gap (see Band.drawTop), keeping the rules that belong to it.
 */
export function ReplicaBlock({
  source,
  band,
  design,
  hrefs,
}: {
  source: ReplicaSource;
  band: Band;
  design: DesignSpec;
  hrefs: Map<string, string>;
}) {
  const page = source.layout.pages[band.page];
  // The first block goes back to the height it printed at, above the design's
  // top margin if need be.
  const above = band.textTop - (band.pinned ? design.page.marginTop * MM_TO_PT : band.top);
  return (
    <div
      data-replica-block
      style={{
        position: 'relative',
        height: `${band.bottom - band.textTop}pt`,
        marginTop: `${above}pt`,
        marginBottom: `${band.gapEnd - band.bottom}pt`,
      }}
    >
      <ReplicaSvg
        source={source}
        index={band.page}
        top={band.drawTop}
        bottom={band.drawBottom}
        hrefs={hrefs}
        fallback={fontStack(design.font.bodyFamily)}
        style={{
          position: 'absolute',
          top: `${band.drawTop - band.textTop}pt`,
          left: `-${design.page.marginLeft}mm`,
          width: `${page.width}pt`,
          height: `${band.drawBottom - band.drawTop}pt`,
        }}
      />
    </div>
  );
}
