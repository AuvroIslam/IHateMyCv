import type { ContentCapture } from './schemas';
import type {
  HeaderField,
  HeaderTemplate,
  HeadingField,
  HeadingTemplate,
  PartStyle,
  SourceLayout,
  SourceLine,
  SourceRun,
} from '@/types/cv';
import { readingOrder, textSize } from './reading-order';

/**
 * Reads how a CV arranges its entry headings and its header, straight from
 * the PDF's coordinates.
 *
 * Templates differ endlessly: "**Nexus AI**, Co-Founder" with the location
 * right and the date below; "Ostad – Teaching Assistant" with the date right
 * and the location below; title left and location right over an italic
 * degree with the date right. A fixed menu of layouts can never cover them,
 * so instead each field is located on the page - which row, which side, what
 * text joins it to its neighbour, bold or italic - and the arrangement is
 * rebuilt from that.
 */

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Private-use glyphs are icon fonts (FontAwesome): never reproduced as text. */
const ICONS = /[-]/gu;
/** A joiner is punctuation and space - anything wordier is unlocated text. */
const JOINER = /^[\s\-–—|,:·•@/()]*$/u;

interface Located {
  line: number;
  start: number;
  end: number;
  run?: SourceRun;
}

interface FlatLine extends SourceLine {
  page: number;
  text: string;
}

function flatten(layout: SourceLayout): FlatLine[] {
  return layout.pages.flatMap((p, page) =>
    [...p.lines].sort(readingOrder).map((l) => ({ ...l, page, text: squash(l.text) })),
  );
}

/**
 * Finds a field's text on the page. `claimed` holds spans already taken by
 * other fields, so "site.com" is not found inside "me@site.com", nor a link
 * labelled with the person's name inside the name itself.
 */
function locate(
  value: string | null | undefined,
  lines: FlatLine[],
  from: number,
  to: number,
  claimed: Located[] = [],
): Located | null {
  const v = squash(value ?? '');
  if (!v) return null;
  for (let i = Math.max(0, from); i <= Math.min(lines.length - 1, to); i++) {
    const hay = lines[i].text.toLowerCase();
    for (let start = hay.indexOf(v.toLowerCase()); start >= 0; start = hay.indexOf(v.toLowerCase(), start + 1)) {
      const end = start + v.length;
      if (claimed.some((c) => c.line === i && start < c.end && end > c.start)) continue;
      return { line: i, start, end, run: runAt(lines[i], start) ?? runByText(lines[i], v) };
    }
  }
  return null;
}

/** The run holding character `index` of the line's text. */
function runAt(line: FlatLine, index: number): SourceRun | undefined {
  let pos = 0;
  for (const r of [...line.runs].sort((a, b) => a.x - b.x)) {
    const t = squash(r.text);
    if (!t) continue;
    const at = line.text.indexOf(t, pos);
    if (at < 0) continue;
    if (index < at + t.length) return r;
    pos = at + t.length;
  }
  return undefined;
}

function runByText(line: FlatLine, value: string): SourceRun | undefined {
  const head = norm(value).slice(0, 6);
  return line.runs.find((r) => head && norm(r.text).includes(head));
}

function styleOf(run: SourceRun | undefined): PartStyle {
  if (!run) return 'normal';
  if (run.bold && run.italic) return 'bold-italic';
  if (run.bold) return 'bold';
  if (run.italic) return 'italic';
  return 'normal';
}

function joinerBetween(text: string, from: number, to: number): string {
  const raw = text.slice(from, to).replace(ICONS, '');
  return JOINER.test(raw) ? raw : ' ';
}

/** The most frequent value of a key, by its JSON form. */
function mode<T>(values: T[]): T | undefined {
  const counts = new Map<string, { v: T; n: number }>();
  for (const v of values) {
    const k = JSON.stringify(v);
    counts.set(k, { v, n: (counts.get(k)?.n ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.v;
}

// ---------------------------------------------------------------------------
// Entry headings

interface Placement {
  row: number;
  side: 'left' | 'right' | 'gutter';
  order: number;
  joiner: string;
  style: PartStyle;
  size: number;
}

export function detectHeadingTemplates(
  content: ContentCapture,
  layout: SourceLayout,
  /** Where the content column starts, in a layout with a left gutter. */
  gutterX?: number,
): Map<string, HeadingTemplate> {
  const lines = flatten(layout);
  const pageW = layout.pages[0]?.width ?? 595;
  // Each column's extent, page by page; outside columns, the page's text block.
  const spans = new Map<string, [number, number]>();
  for (const l of lines) {
    const k = `${l.page}:${l.col ?? 0}`;
    const [a, b] = spans.get(k) ?? [Infinity, -Infinity];
    spans.set(k, [Math.min(a, l.x), Math.max(b, l.xEnd)]);
  }
  const columnSpan = (l: FlatLine): [number, number] => spans.get(`${l.page}:${l.col ?? 0}`) ?? [0, pageW];
  const bySection = new Map<string, Map<HeadingField, Placement[]>>();
  let cursor = 0;

  for (const e of content.entries) {
    if (!e.title?.trim()) continue;
    const t = locate(e.title, lines, cursor, lines.length - 1);
    if (!t) continue;
    cursor = t.line;

    const fields: [HeadingField, string | null][] = [
      ['title', e.title],
      ['subtitle', e.subtitle],
      ['location', e.location],
      ['date', e.dateText],
      ['note', (e as { note?: string }).note ?? null],
    ];
    const found = fields
      .map(([field, value]) => {
        const at = field === 'title' ? t : locate(value, lines, t.line - 1, t.line + 2);
        return at ? { field, at } : null;
      })
      .filter((x): x is { field: HeadingField; at: Located } => x !== null);
    if (found.length < 2) continue;

    // Visual rows: a date set a few points above or below its title is a
    // separate line in the PDF but the same row on the page.
    const rowOf = new Map<number, number>();
    {
      const used = [...new Set(found.map((f) => f.at.line))].sort((a, b) => lines[a].y - lines[b].y);
      let row = -1;
      let prev: FlatLine | null = null;
      for (const li of used) {
        const l = lines[li];
        if (!prev || l.page !== prev.page || l.y - prev.y > Math.max(l.size, prev.size) * 0.75) row++;
        rowOf.set(li, row);
        prev = l;
      }
    }
    // Right-aligned: set apart by a wide gap and ending on the column's right
    // edge, or alone on its row past the column's centre. A long left part
    // ("CORNELL ROBOT LEARNING LAB | Researcher") can push a joined field
    // past the centre without making it right-aligned.
    const side = (f: { at: Located }): Placement['side'] => {
      const line = lines[f.at.line];
      const run = f.at.run;
      if (!run) return 'left';
      if (gutterX != null && run.xEnd <= gutterX - 2) return 'gutter';
      const [left, right] = columnSpan(line);
      const runs = [...line.runs].sort((a, b) => a.x - b.x);
      // Clusters split at wide gaps; only the last one can sit on the right.
      let cluster = 0;
      let clusters = 1;
      for (let k = 1; k < runs.length; k++) {
        if (runs[k].x - runs[k - 1].xEnd > 12) {
          clusters++;
          if (runs.indexOf(run) >= k) cluster++;
        }
      }
      const flushRight = right - line.xEnd < 8;
      if (clusters > 1) return flushRight && cluster === clusters - 1 ? 'right' : 'left';
      return flushRight && run.x > (left + right) / 2 ? 'right' : 'left';
    };
    const groups = new Map<string, typeof found>();
    for (const f of found) {
      const key = `${f.at.line}:${side(f)}`;
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.at.start - b.at.start);
      group.forEach((f, i) => {
        const placements = bySection.get(e.sectionId) ?? new Map<HeadingField, Placement[]>();
        const list = placements.get(f.field) ?? [];
        list.push({
          row: rowOf.get(f.at.line)!,
          side: side(f),
          order: i,
          joiner: i === 0 ? '' : joinerBetween(lines[f.at.line].text, group[i - 1].at.end, f.at.start),
          style: styleOf(f.at.run),
          size: f.at.run?.size ?? textSize(lines[f.at.line]),
        });
        placements.set(f.field, list);
        bySection.set(e.sectionId, placements);
      });
    }
  }

  const out = new Map<string, HeadingTemplate>();
  for (const [sectionId, placements] of bySection) {
    const chosen = [...placements.entries()]
      .map(([field, ps]) => {
        // Position first, then the most common joiner and style at it.
        const where = mode(ps.map((p) => ({ row: p.row, side: p.side, order: p.order })))!;
        const here = ps.filter((p) => p.row === where.row && p.side === where.side && p.order === where.order);
        return {
          field,
          ...where,
          joiner: mode(here.map((p) => p.joiner)) ?? '',
          style: mode(here.map((p) => p.style)) ?? 'normal',
          size: mode(here.map((p) => p.size)),
        };
      })
      .filter((c) => c.row >= 0 && c.row < 3);
    if (!chosen.some((c) => c.field === 'title')) continue;

    const rowCount = Math.max(...chosen.map((c) => c.row)) + 1;
    const rows: HeadingTemplate['rows'] = Array.from({ length: rowCount }, () => ({ left: [], right: [] }));
    const gutter: HeadingTemplate['gutter'] = [];
    for (const c of chosen.sort((a, b) => a.order - b.order)) {
      const part = { field: c.field, joiner: c.joiner, style: c.style, ...(c.size ? { sizePt: c.size } : {}) };
      if (c.side === 'gutter') gutter.push({ ...part, joiner: gutter.length ? part.joiner : '' });
      else rows[c.row][c.side].push(part);
    }
    // The first field after the gutter has nothing to join to on its row.
    for (const row of rows) if (row.left[0]) row.left[0] = { ...row.left[0], joiner: '' };
    out.set(sectionId, { rows: rows.filter((r) => r.left.length || r.right.length), ...(gutter.length ? { gutter } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Header

export function detectHeaderTemplate(content: ContentCapture, layout: SourceLayout): HeaderTemplate | null {
  const lines = flatten(layout);
  const pageW = layout.pages[0]?.width ?? 595;
  // The header ends at the first section heading. In a two-column CV that
  // heading shares its PDF line with the other column's, so match a heading
  // at the start of the line or as a run of its own, not the whole line.
  const titles = content.sections.map((s) => norm(s.title)).filter((t) => t.length > 2);
  let end = lines.findIndex(
    (l) => titles.some((t) => norm(l.text).startsWith(t)) || l.runs.some((r) => titles.includes(norm(r.text))),
  );
  if (end < 0) end = Math.min(lines.length, 4);
  const region = lines.slice(0, end);
  if (!region.length) return null;

  const p = content.personal;
  const fields: [HeaderField, string | null][] = [
    ['name', p.fullName],
    ['headline', p.headline],
    ['email', p.email],
    ['phone', p.phone],
    ['location', p.location],
    ...p.links.map((l, i) => [`link:${i}` as HeaderField, l.label] as [HeaderField, string]),
  ];
  // Most specific first, each claiming its text, so a website cannot be
  // found inside the email or a link label inside the name.
  const order: HeaderField[] = ['email', 'phone', 'name', 'location', 'headline'];
  const sorted = [...fields].sort((a, b) => {
    const ia = order.indexOf(a[0]);
    const ib = order.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const claimed: Located[] = [];
  const found: { field: HeaderField; at: Located }[] = [];
  for (const [field, value] of sorted) {
    const at = locate(value, region, 0, region.length - 1, claimed);
    if (!at) continue;
    claimed.push(at);
    found.push({ field, at });
  }
  if (!found.some((f) => f.field === 'name')) return null;

  // A header line splits into clusters at wide gaps: "NAME ...... phone – city"
  // is a left cluster and a right cluster, even when the right one is long
  // enough to start before the page centre.
  // Margins from the whole page: the widest header line is not the margin.
  const contentLeft = Math.min(...lines.map((l) => l.x));
  const contentRight = Math.max(...lines.map((l) => l.xEnd));
  const placeOf = (f: { at: Located }): 'left' | 'center' | 'right' => {
    const line = region[f.at.line];
    // A line centred on the page that does not run margin to margin is one
    // centred group, however wide the gaps around its icons.
    const spansAll = line.x <= contentLeft + 3 && line.xEnd >= contentRight - 3;
    if (!spansAll && Math.abs((line.x + line.xEnd) / 2 - pageW / 2) < 18) return 'center';
    const runs = [...line.runs].sort((a, b) => a.x - b.x);
    const clusters: SourceRun[][] = [];
    for (const r of runs) {
      const last = clusters[clusters.length - 1];
      if (last && r.x - last[last.length - 1].xEnd < 15) last.push(r);
      else clusters.push([r]);
    }
    const run = f.at.run ?? runs[0];
    const index = clusters.findIndex((c) => c.includes(run));
    const cluster = clusters[index] ?? clusters[0];
    const cStart = cluster[0].x;
    const cEnd = cluster[cluster.length - 1].xEnd;
    if (clusters.length === 1) {
      const centre = (cStart + cEnd) / 2;
      if (Math.abs(centre - pageW / 2) < 18 && cStart > contentLeft + 12) return 'center';
      return contentRight - cEnd < 3 && cStart > contentLeft + 12 ? 'right' : 'left';
    }
    if (index === 0) return 'left';
    const lastFlush = contentRight - clusters[clusters.length - 1][clusters[clusters.length - 1].length - 1].xEnd < 6;
    if (index === clusters.length - 1 && lastFlush) return 'right';
    // A middle part between a left and a flush-right one is centred. Without
    // a flush-right part the line is a left-aligned row with wide gaps
    // (contact items whose icons were left out).
    return lastFlush ? 'center' : 'left';
  };

  // Header lines holding no personal field (a motto, a tagline) stay, verbatim.
  const literals: string[] = [];
  region.forEach((line, i) => {
    if (found.some((f) => f.at.line === i)) return;
    const text = line.text.replace(ICONS, '').trim();
    if (!text || /^last updated/i.test(text)) return;
    literals.push(text);
    found.push({ field: `text:${literals.length - 1}`, at: { line: i, start: 0, end: line.text.length, run: line.runs[0] } });
  });

  const lineIds = [...new Set(found.map((f) => f.at.line))].sort((a, b) => a - b);
  const rows: HeaderTemplate['rows'] = lineIds.map(() => ({ left: [], center: [], right: [] }));
  lineIds.forEach((lineId, r) => {
    const here = found.filter((f) => f.at.line === lineId);
    for (const place of ['left', 'center', 'right'] as const) {
      const group = here.filter((f) => placeOf(f) === place).sort((a, b) => a.at.start - b.at.start);
      group.forEach((f, i) => {
        let joiner = i === 0 ? '' : region[lineId].text.slice(group[i - 1].at.end, f.at.start).replace(ICONS, '');
        // Labels ("Email:") are printed by the renderer from contactLabels.
        joiner = joiner.replace(/[A-Za-z][A-Za-z .]*:\s*$/u, '');
        if (!JOINER.test(joiner)) joiner = ' ';
        // A blank joiner over a wide gap: keep the gap's width.
        const prev = group[i - 1];
        const gap = i > 0 && prev.at.run && f.at.run && f.at.run !== prev.at.run ? f.at.run.x - prev.at.run.xEnd : 0;
        const gapPt = !joiner.trim() && gap > 6 ? Math.round(gap * 10) / 10 : undefined;
        const sizePt = f.at.run?.size ?? textSize(region[lineId]);
        rows[r][place].push({ field: f.field, joiner, ...(gapPt ? { gapPt } : {}), style: styleOf(f.at.run), ...(sizePt ? { sizePt } : {}) });
      });
    }
  });
  return { rows, ...(literals.length ? { literals } : {}) };
}

// ---------------------------------------------------------------------------
// Consistent entries

/**
 * Where each entry's subtitle sits relative to its title: the line below
 * (+1), above (-1), or on the same line after (0.5) or before (-0.5) it.
 * Null when either cannot be found.
 */
function shapes(content: ContentCapture, lines: FlatLine[]): (number | null)[] {
  let cursor = 0;
  return content.entries.map((e) => {
    if (!e.title?.trim() || !e.subtitle?.trim()) return null;
    const t = locate(e.title, lines, cursor, lines.length - 1);
    if (!t) return null;
    cursor = t.line;
    const s = locate(e.subtitle, lines, t.line - 1, t.line + 1);
    if (!s) return null;
    if (s.line !== t.line) return Math.sign(s.line - t.line);
    return s.start > t.start ? 0.5 : -0.5;
  });
}

/**
 * Makes title and subtitle mean the same thing throughout a section. The
 * model labels "Blog Writer / SLU Computer Science Department" one way and
 * "Financial Network Services / Unix Administrator Assistant" the other,
 * though the page sets both alike - bold organisation over italic role, say.
 * An entry printed as the mirror image of its section's usual arrangement
 * has its two fields swapped, so one heading template fits every entry.
 */
export function harmonizeEntries(content: ContentCapture, layout: SourceLayout): ContentCapture {
  const lines = flatten(layout);
  const shape = shapes(content, lines);
  const bySection = new Map<string, number[]>();
  content.entries.forEach((e, i) => {
    if (shape[i] == null) return;
    bySection.set(e.sectionId, [...(bySection.get(e.sectionId) ?? []), shape[i]!]);
  });
  const usual = new Map<string, number>();
  for (const [id, list] of bySection) {
    const counts = new Map<number, number>();
    for (const v of list) counts.set(v, (counts.get(v) ?? 0) + 1);
    // Ties go to the section's first entry.
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || list.indexOf(a[0]) - list.indexOf(b[0]))[0];
    usual.set(id, best[0]);
  }
  return {
    ...content,
    entries: content.entries.map((e, i) => {
      const want = usual.get(e.sectionId);
      return shape[i] != null && want != null && shape[i] === -want ? { ...e, title: e.subtitle!, subtitle: e.title } : e;
    }),
  };
}

/**
 * Sections where consecutive entries share an organisation the original
 * printed once: the shared subtitle appears on the page fewer times than the
 * entries carrying it.
 */
export function detectMergedRepeats(content: ContentCapture, layout: SourceLayout): Set<string> {
  const lines = flatten(layout);
  const out = new Set<string>();
  const entries = content.entries;
  for (let i = 1; i < entries.length; i++) {
    const [a, b] = [entries[i - 1], entries[i]];
    const shared = b.subtitle?.trim();
    if (a.sectionId !== b.sectionId || !shared || shared !== a.subtitle?.trim() || (a.location ?? '') !== (b.location ?? '')) continue;
    const key = norm(shared);
    const printed = lines.filter((l) => norm(l.text).includes(key)).length;
    let run = 1;
    for (let k = i; k < entries.length && entries[k].sectionId === a.sectionId && entries[k].subtitle?.trim() === shared; k++) run++;
    if (printed > 0 && printed < run) out.add(a.sectionId);
  }
  return out;
}

/**
 * A detail the model filed as a bullet but the page prints on one of the
 * entry's heading rows, set apart by a wide gap ("Bachelor of Science ......
 * GPA: 3.5"). It moves to the entry's note, which the heading template then
 * places where it was.
 */
export function liftHeadingNotes(content: ContentCapture, layout: SourceLayout): ContentCapture {
  const lines = flatten(layout);
  let cursor = 0;
  return {
    ...content,
    entries: content.entries.map((e) => {
      if (!e.title?.trim()) return e;
      const t = locate(e.title, lines, cursor, lines.length - 1);
      if (!t) return e;
      cursor = t.line;
      // A title that swallowed its right-aligned date ("Gemma Hackathon 2026"
      // where the page prints "2026" apart at the right edge): split it off.
      if (!e.dateText?.trim()) {
        const runs = [...lines[t.line].runs].sort((a, b) => a.x - b.x);
        const last = runs[runs.length - 1];
        const before = runs[runs.length - 2];
        const tail = last ? squash(last.text) : '';
        if (before && last.x - before.xEnd > 12 && tail && e.title.trim().endsWith(tail) && e.title.trim() !== tail) {
          e = { ...e, title: e.title.trim().slice(0, -tail.length).trim(), dateText: tail };
        }
      }
      const rows = new Set([t.line]);
      for (const v of [e.subtitle, e.location, e.dateText]) {
        const at = locate(v, lines, t.line - 1, t.line + 2);
        if (at) rows.add(at.line);
      }
      // A detail printed straight after a heading field on its line
      // ("Remote | 4 Months") is part of that field, not a bullet.
      for (const key of ['location', 'subtitle'] as const) {
        const value = e[key]?.trim();
        const at = value ? locate(value, lines, t.line - 1, t.line + 2) : null;
        if (!value || !at) continue;
        const rest = lines[at.line].text.slice(at.end);
        const j = e.bullets.findIndex((b) => {
          const m = rest.match(/^\s*([|,·•–—-])\s*/u);
          return b.length <= 40 && m != null && rest.slice(m[0].length).trim() === b.trim();
        });
        if (j >= 0) {
          return { ...e, [key]: `${value}${rest}`.trim(), bullets: e.bullets.filter((_, k) => k !== j) } as typeof e;
        }
      }

      const i = e.bullets.findIndex((b) => {
        if (b.length > 40) return false;
        const at = locate(b, lines, t.line - 1, t.line + 2);
        if (!at || !rows.has(at.line) || !at.run) return false;
        // Its own cluster: a wide gap before it on the row.
        const runs = [...lines[at.line].runs].sort((a, b) => a.x - b.x);
        const k = runs.indexOf(at.run);
        return k > 0 && at.run.x - runs[k - 1].xEnd > 12;
      });
      if (i < 0) return e;
      return { ...e, note: e.bullets[i], bullets: e.bullets.filter((_, k) => k !== i) } as typeof e;
    }),
  };
}

/**
 * Sections whose entries print their links after the bullet lines (a DOI
 * under the authors) rather than under the heading: in most entries with
 * both, the link's line comes after the first bullet's.
 */
export function detectLinksAfter(content: ContentCapture, layout: SourceLayout): Set<string> {
  const lines = flatten(layout);
  const votes = new Map<string, { after: number; total: number }>();
  let cursor = 0;
  for (const e of content.entries) {
    if (!e.title?.trim()) continue;
    const t = locate(e.title, lines, cursor, lines.length - 1);
    if (!t) continue;
    cursor = t.line;
    const label = e.links?.[0]?.label;
    if (!label || !e.bullets.length) continue;
    const link = locate(label, lines, t.line, t.line + 8);
    const bullet = locate(e.bullets[0].slice(0, 40), lines, t.line, t.line + 8);
    if (!link || !bullet) continue;
    const v = votes.get(e.sectionId) ?? { after: 0, total: 0 };
    v.total++;
    if (link.line > bullet.line) v.after++;
    votes.set(e.sectionId, v);
  }
  return new Set([...votes].filter(([, v]) => v.after / v.total > 0.5).map(([id]) => id));
}
