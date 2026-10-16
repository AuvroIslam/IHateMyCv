import type { ContentCapture, ExtractionResult } from './schemas';
import type { HeaderTemplate, HeadingTemplate, SourceLayout } from '@/types/cv';
import {
  detectHeaderTemplate,
  detectHeadingTemplates,
  detectLinksAfter,
  detectMergedRepeats,
  harmonizeEntries,
  liftHeadingNotes,
} from './template-detect';
import { readingOrder } from './reading-order';

/**
 * Design facts the PDF states outright, applied over the model's reading.
 *
 * The design pass runs at low effort to keep uploads fast; at that effort it
 * occasionally misjudges things that need no judgement at all. Each check
 * here only overrides when the coordinates are unambiguous.
 */

type RawDesign = ExtractionResult['design'];

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export function applyMeasuredFacts(
  design: RawDesign,
  content: ContentCapture,
  layout: SourceLayout | null,
): RawDesign {
  if (!layout || layout.pages.length === 0) return design;
  const next = structuredClone(design);
  const lines = layout.pages.flatMap((p) => p.lines);

  // Paper size is in the file. US Letter is 612pt wide; A4 is 595.
  const width = layout.pages[0].width;
  next.page.size = Math.abs(width - 612) < 6 ? 'letter' : 'a4';

  // Side margins can be no wider than the text allows: text never runs into
  // the margin. The text's edge is the furthest any two lines reach (a
  // right-aligned date column, a justified paragraph); one stray line does
  // not set it. A margin the text crosses is a misreading - models sometimes
  // answer in points rather than millimetres - and gives way to the edge.
  // Narrower ones stand: ragged text stops short of the true margin.
  const PT_PER_MM = 72 / 25.4;
  const edge = (xs: number[], dir: 1 | -1) => {
    const sorted = [...xs].sort((a, b) => dir * (b - a));
    return sorted.find((v, i) => sorted.slice(i + 1).some((w) => Math.abs(w - v) <= 1.5));
  };
  const right = edge(lines.map((l) => l.xEnd), 1);
  const left = edge(lines.map((l) => l.x), -1);
  const room = (pt: number) => Math.round((pt / PT_PER_MM) * 100) / 100;
  if (right != null && right < width && next.page.marginRight > room(width - right) + 1) {
    next.page.marginRight = room(width - right);
  }
  if (left != null && left > 0 && next.page.marginLeft > room(left) + 1) next.page.marginLeft = room(left);

  const gutter = next.layout.type === 'single' ? detectGutter(content, layout) : null;
  if (gutter) Object.assign(next.layout, { gutterPt: gutter.width, gutterGapPt: gutter.gap });
  const margin = Math.min(...lines.map((l) => l.x));

  // Entry headings and the header, arranged as the original arranged them.
  const headings = detectHeadingTemplates(content, layout, gutter ? margin + gutter.width : undefined);
  const merged = detectMergedRepeats(content, layout);
  const linksAfter = detectLinksAfter(content, layout);
  type Extra = { heading?: HeadingTemplate; mergeRepeats?: boolean; numbered?: 'asc' | 'desc'; linksAfter?: boolean };
  for (const section of next.sections as (RawDesign['sections'][number] & Extra)[]) {
    const t = headings.get(section.id);
    if (t) section.heading = t;
    if (merged.has(section.id)) section.mergeRepeats = true;
    const numbered = detectNumbering(content, lines, section.id);
    if (numbered) section.numbered = numbered;
    if (linksAfter.has(section.id)) section.linksAfter = true;
  }
  const header = detectHeaderTemplate(content, layout);
  if (header) (next.header as RawDesign['header'] & { template?: HeaderTemplate }).template = header;

  // A skills grid in the coordinates means the columns layout; categories
  // in a column of their own mean the table layout; skill lines that open
  // with a bullet glyph mean the bullets layout.
  const table = readSkillTable(content, layout);
  if (table) {
    Object.assign(next.skills, { layout: 'table', itemsAtPt: table.itemsAt, categoryAlign: table.align, categoryGapPt: table.gap });
  } else if (readSkillGrid(content, layout)) {
    next.skills.layout = 'columns';
    next.skills.columns = 2;
  } else {
    const firstSkills = content.skillGroups.map((g) => norm(g.category || g.skills[0] || '').slice(0, 12)).filter(Boolean);
    const skillLines = lines.filter((l) => firstSkills.some((k) => norm(l.text).includes(k)));
    const bulleted = skillLines.filter((l) => GLYPH.test(l.text) && /^\s*[•·◦▪∙‣–-]\s/u.test(l.text)).length;
    if (skillLines.length >= 2 && bulleted / skillLines.length > 0.5) next.skills.layout = 'bullets';
  }

  const align = detectTextAlign(layout);
  if (align) next.font.textAlign = align;

  // One-line headings, per section: does the subtitle share the title's line,
  // which comes first, and what joins them? CVs mix styles - "Ostad –
  // Teaching Assistant" in Experience, "Hackathon - Organiser" in Awards.
  type Shape = { layout: 'org-title' | 'title-org' | 'title-left-date-right'; joiner?: string };
  const shapes = new Map<string, Shape[]>();
  for (const e of content.entries) {
    if (!e.subtitle || !e.title) continue;
    const line = lines.find((l) => norm(l.text).includes(norm(e.title).slice(0, 16)));
    if (!line) continue;
    const text = line.text;
    const ti = text.indexOf(e.title);
    const si = text.indexOf(e.subtitle);
    let shape: Shape = { layout: 'title-left-date-right' };
    if (ti >= 0 && si >= 0) {
      shape =
        si < ti
          ? { layout: 'org-title', joiner: text.slice(si + e.subtitle.length, ti) }
          : { layout: 'title-org', joiner: text.slice(ti + e.title.length, si) };
      // Anything longer than a separator means they are not simply joined.
      if (!/^\s*[-–—|,:·•]?\s*$/u.test(shape.joiner ?? '')) shape = { layout: 'title-left-date-right' };
    }
    const list = shapes.get(e.sectionId) ?? [];
    list.push(shape);
    shapes.set(e.sectionId, list);
  }
  for (const section of next.sections as (RawDesign['sections'][number] & { entryLayout?: string; titleJoiner?: string })[]) {
    const list = shapes.get(section.id);
    if (!list?.length) continue;
    const counts = new Map<string, number>();
    for (const sh of list) counts.set(sh.layout, (counts.get(sh.layout) ?? 0) + 1);
    const winner = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0] as Shape['layout'];
    if (winner !== next.entry.layout) section.entryLayout = winner;
    const joiner = list.find((sh) => sh.layout === winner)?.joiner;
    if (joiner != null && winner !== 'title-left-date-right') section.titleJoiner = joiner;
  }

  return next;
}

const GLYPH = /^\s*[•·◦▪∙‣–-]\s*/u;

/**
 * Justified text: the wrapped lines of every paragraph end flush on one
 * right edge; ragged text's line ends wander by many points. Only lines that
 * wrap onto a continuation count - a paragraph's last line and a one-line
 * bullet end wherever their words do either way. Null without evidence.
 */
/**
 * A left gutter (moderncv): every section heading starts well right of the
 * page's left margin, and lines carry text in that gutter - dates, set flush
 * right against the content - on the same baseline as content to their right.
 */
export function detectGutter(content: ContentCapture, layout: SourceLayout): { width: number; gap: number } | null {
  const lines = layout.pages.flatMap((p) => p.lines);
  const titles = new Set(content.sections.map((s) => norm(s.title)).filter((t) => t.length > 2));
  const headingXs = lines.filter((l) => titles.has(norm(l.text))).map((l) => l.x);
  if (headingXs.length < 2) return null;
  const sorted = [...headingXs].sort((a, b) => a - b);
  const contentX = sorted[Math.floor(sorted.length / 2)];
  if (sorted[sorted.length - 1] - sorted[0] > 3) return null;
  const margin = Math.min(...lines.map((l) => l.x));
  if (contentX - margin < 40) return null;
  // Gutter text: runs ending before the content column on lines that go on
  // into it. Their right edges line up, a few points short of the column.
  const ends = lines.flatMap((l) => {
    const runs = [...l.runs].sort((a, b) => a.x - b.x);
    const inGutter = runs.filter((r) => r.xEnd <= contentX - 2);
    const beyond = runs.some((r) => r.x >= contentX - 1);
    return inGutter.length && beyond ? [Math.max(...inGutter.map((r) => r.xEnd))] : [];
  });
  if (ends.length < 2) return null;
  const end = [...ends].sort((a, b) => a - b)[Math.floor(ends.length / 2)];
  if (ends.filter((e) => Math.abs(e - end) <= 1.5).length / ends.length < 0.6) return null;
  return { width: Math.round((contentX - margin) * 10) / 10, gap: Math.round((contentX - end) * 10) / 10 };
}

/**
 * A section whose items the original numbers ("1. Adaptive Quantization..."):
 * the numbers in front of its bullets' lines, counting up or down.
 */
function detectNumbering(content: ContentCapture, lines: SourceLayout['pages'][number]['lines'], sectionId: string): 'asc' | 'desc' | null {
  const bullets = content.entries.filter((e) => e.sectionId === sectionId).flatMap((e) => e.bullets);
  if (bullets.length < 2) return null;
  const nums: number[] = [];
  for (const b of bullets) {
    const key = norm(b).slice(0, 20);
    if (key.length < 6) continue;
    const line = lines.find((l) => /^\s*\d{1,2}[.)]\s/.test(l.text) && norm(l.text.replace(/^\s*\d{1,2}[.)]\s*/, '')).startsWith(key));
    if (line) nums.push(Number(line.text.trim().match(/^\d+/)![0]));
  }
  if (nums.length < 2 || nums.length < bullets.length * 0.6) return null;
  const steps = nums.slice(1).map((n, i) => n - nums[i]);
  if (steps.every((d) => d === 1)) return 'asc';
  if (steps.every((d) => d === -1)) return 'desc';
  return null;
}

const hasWideGap = (l: SourceLayout['pages'][number]['lines'][number]) => {
  const runs = [...l.runs].sort((a, b) => a.x - b.x);
  return runs.some((r, k) => k > 0 && r.x - runs[k - 1].xEnd > 12);
};

export function detectTextAlign(layout: SourceLayout): 'justify' | 'left' | null {
  const wrapped = layout.pages.flatMap((p) => {
    const ordered = [...p.lines].sort(readingOrder);
    return ordered.filter((l, i) => {
      const n = ordered[i + 1];
      return (
        n &&
        (n.col ?? 0) === (l.col ?? 0) &&
        Math.abs(n.size - l.size) < 0.3 &&
        n.y - l.y > 0 &&
        n.y - l.y < l.size * 1.8 &&
        n.x >= l.x - 1 &&
        !GLYPH.test(n.text) &&
        l.text.length > 30 &&
        // Not a heading row with a right-aligned date: that one is flush by design.
        !hasWideGap(l)
      );
    });
  });
  if (wrapped.length < 4) return null;
  // Per column: a two-column CV has two right edges.
  const edge = new Map<number, number>();
  for (const l of wrapped) edge.set(l.col ?? 0, Math.max(edge.get(l.col ?? 0) ?? 0, l.xEnd));
  // A few points of slack: extracted widths drop some glyphs (soft hyphens)
  // and trailing kerning. Ragged lines wander by tens of points.
  const flush = wrapped.filter((l) => edge.get(l.col ?? 0)! - l.xEnd < 6).length;
  return flush / wrapped.length >= 0.6 ? 'justify' : 'left';
}

/**
 * Content facts the PDF states outright: whether a skill category's items
 * carry bullet glyphs, and whether its label is printed with a colon. Checked
 * run by run, so a two-column grid (where both columns share PDF lines) works.
 */
export function applyContentFacts(content: ContentCapture, layout: SourceLayout | null): ContentCapture {
  if (!layout) return content;
  const lines = layout.pages.flatMap((p) => p.lines);
  content = liftHeadingNotes(harmonizeEntries(content, layout), layout);

  // A skills grid read from coordinates beats the model's reading of it.
  const grid = readSkillGrid(content, layout);
  const skillsSection = content.sections.find((s) => s.type === 'skills');
  if (grid && skillsSection) {
    content = {
      ...content,
      skillGroups: [
        ...content.skillGroups.filter((g) => g.sectionId !== skillsSection.id),
        ...grid.map((g) => ({ sectionId: skillsSection.id, category: g.category, skills: g.skills, list: g.list })),
      ],
    };
    return content;
  }

  const bulleted = (item: string) => {
    const key = norm(item).slice(0, 12);
    if (key.length < 3) return null;
    for (const line of lines) {
      const i = line.runs.findIndex((r) => norm(r.text.replace(GLYPH, '')).startsWith(key));
      if (i < 0) continue;
      const run = line.runs[i];
      return GLYPH.test(run.text) || (i > 0 && /^[•·◦▪∙‣–-]$/u.test(line.runs[i - 1].text.trim()));
    }
    return null;
  };

  return {
    ...content,
    skillGroups: content.skillGroups.map((g) => {
      const votes = g.skills.map(bulleted).filter((v): v is boolean => v !== null);
      const list = votes.length ? votes.filter(Boolean).length / votes.length > 0.5 : g.list;

      let category = g.category;
      const label = norm(category);
      if (label && !category.trim().endsWith(':')) {
        const printed = lines.flatMap((l) => l.runs).find((r) => norm(r.text) === label);
        if (printed?.text.trim().endsWith(':')) category = `${category.trim()}:`;
      }
      // Stacked: the category is a line of its own and most items are too
      // ("PROGRAMMING" / "Over 5000 lines:" / "Java • Shell • Python").
      const whole = new Set(lines.map((l) => norm(l.text.replace(GLYPH, ''))));
      const ownLines = g.skills.filter((s) => norm(s).length >= 3 && whole.has(norm(s))).length;
      const stacked = !list && g.skills.length >= 2 && whole.has(label) && ownLines / g.skills.length >= 0.6;
      return { ...g, list, category, ...(stacked ? { stacked: true } : {}) };
    }),
  };
}

// ---------------------------------------------------------------------------
// Skill tables

/**
 * Categories in a column of their own ("DevOps | AWS, Docker, ..."): every
 * category's items start on one tab stop, and the categories line up on one
 * edge - their right edge when set flush against the items. Offsets are from
 * the section heading's left edge.
 */
export function readSkillTable(
  content: ContentCapture,
  layout: SourceLayout,
): { itemsAt: number; align: 'left' | 'right'; gap: number } | null {
  const section = content.sections.find((s) => s.type === 'skills');
  const groups = content.skillGroups.filter((g) => g.category.trim() && g.skills.length);
  if (!section || groups.length < 2) return null;
  const lines = layout.pages.flatMap((p) => p.lines);
  const heading = lines.find((l) => norm(l.text) === norm(section.title));
  if (!heading) return null;

  const rows: { catX: number; catEnd: number; itemX: number }[] = [];
  for (const g of groups) {
    const label = norm(g.category);
    const first = norm(g.skills[0]).slice(0, 8);
    for (const line of lines) {
      const runs = [...line.runs].sort((a, b) => a.x - b.x);
      const c = runs.findIndex((r) => norm(r.text) === label);
      if (c < 0) continue;
      const item = runs.slice(c + 1).find((r) => norm(r.text).startsWith(first.slice(0, 4)) || norm(r.text).includes(first));
      if (!item) continue;
      rows.push({ catX: runs[c].x, catEnd: runs[c].xEnd, itemX: item.x });
      break;
    }
  }
  if (rows.length < Math.max(2, groups.length * 0.6)) return null;
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  if (spread(rows.map((r) => r.itemX)) > 2) return null;
  const itemX = rows[0].itemX;
  if (itemX - Math.max(...rows.map((r) => r.catEnd)) < 4) return null;
  // Most rows on one edge: a label can measure short (a hyphen pdf.js drops).
  const onEdge = (xs: number[]) => {
    const mid = [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    return xs.filter((x) => Math.abs(x - mid) <= 1.5).length / xs.length >= 0.6;
  };
  const ends = rows.map((r) => r.catEnd);
  const starts = rows.map((r) => r.catX);
  const align = onEdge(starts) ? 'left' : onEdge(ends) ? 'right' : null;
  if (!align) return null;
  const gap = itemX - Math.max(...ends);
  return { itemsAt: Math.round((itemX - heading.x) * 10) / 10, align, gap: Math.round(gap * 10) / 10 };
}

// ---------------------------------------------------------------------------
// Skill grids

interface GridGroup {
  category: string;
  skills: string[];
  list: boolean;
}

/**
 * Reads a multi-column skills grid straight from the coordinates: runs split
 * at the column boundary, bold lines are category labels, glyph lines are
 * list items, indented plain lines continue the item above. The model reads
 * these grids inconsistently because both columns share each PDF line; the
 * coordinates do not. Returns null when the section is not a grid, or when
 * the layout predates per-run bold flags.
 */
export function readSkillGrid(content: ContentCapture, layout: SourceLayout): GridGroup[] | null {
  const order = content.sections;
  const index = order.findIndex((s) => s.type === 'skills');
  if (index < 0) return null;
  const heading = norm(order[index].title);
  const nextHeading = order[index + 1] ? norm(order[index + 1].title) : null;

  const lines = layout.pages.flatMap((p, page) =>
    [...p.lines].sort(readingOrder).map((l) => ({ ...l, page })),
  );
  const start = lines.findIndex((l) => norm(l.text) === heading);
  if (start < 0) return null;
  let end = nextHeading ? lines.findIndex((l, i) => i > start && norm(l.text) === nextHeading) : -1;
  if (end < 0) end = lines.length;
  // In a column, the section ends with its column, whatever heading the
  // next section has.
  const col = lines[start].col;
  const region = lines
    .slice(start + 1, end)
    .filter((l) => !col || (l.col === col && l.page === lines[start].page));
  const runs = region.flatMap((l) => l.runs.map((r) => ({ ...r, y: l.y, page: l.page })));
  if (!runs.length || !runs.some((r) => r.bold)) return null;

  const left = Math.min(...runs.map((r) => r.x));
  const far = runs.filter((r) => r.x > left + 100);
  // One column, or a stray glyph out right (the raised "A" of a LaTeX logo):
  // not a grid. A grid's right column fills rows of its own.
  const farRows = new Set(far.map((r) => `${r.page}:${Math.round(r.y)}`));
  if (farRows.size < 2 || far.reduce((n, r) => n + r.text.trim().length, 0) < 12) return null;
  const mid = (left + Math.min(...far.map((r) => r.x))) / 2;

  const columns = [runs.filter((r) => r.x < mid), runs.filter((r) => r.x >= mid)].map((col) => {
    // One piece per printed line within the column.
    const pieces: { text: string; bold: boolean; x: number }[] = [];
    const rows = new Map<string, typeof col>();
    for (const r of col) {
      const key = `${r.page}:${Math.round(r.y * 2)}`;
      rows.set(key, [...(rows.get(key) ?? []), r]);
    }
    for (const row of [...rows.values()].sort((a, b) => a[0].page - b[0].page || a[0].y - b[0].y)) {
      row.sort((a, b) => a.x - b.x);
      let text = '';
      let endX = -Infinity;
      for (const r of row) {
        if (text && r.x - endX > 1 && !text.endsWith(' ')) text += ' ';
        text += r.text;
        endX = r.xEnd;
      }
      pieces.push({ text: text.replace(/\s+/g, ' ').trim(), bold: row.every((r) => r.bold), x: row[0].x });
    }
    return pieces;
  });

  const parseColumn = (pieces: { text: string; bold: boolean; x: number }[]) => {
    const groups: GridGroup[] = [];
    const colLeft = Math.min(...pieces.map((p) => p.x));
    for (const p of pieces) {
      const bulleted = GLYPH.test(p.text) && /^\s*[•·◦▪∙‣–-]\s/u.test(p.text);
      const current = groups[groups.length - 1];
      if (p.bold && !bulleted) {
        groups.push({ category: p.text, skills: [], list: false });
      } else if (!current) {
        continue;
      } else if (bulleted) {
        current.list = true;
        current.skills.push(p.text.replace(GLYPH, '').trim());
      } else if (current.list && current.skills.length && p.x > colLeft + 3) {
        // A wrapped bullet's continuation line.
        const last = current.skills.length - 1;
        current.skills[last] = current.skills[last].endsWith('-')
          ? current.skills[last].slice(0, -1) + p.text
          : `${current.skills[last]} ${p.text}`;
      } else {
        current.skills.push(...p.text.split(/,\s*/).map((t) => t.trim()).filter(Boolean));
      }
    }
    return groups.filter((g) => g.skills.length);
  };

  const [l, r] = columns.map(parseColumn);
  if (l.length + r.length < 2) return null;
  // Row-major, the order a grid renderer fills: L1, R1, L2, R2, ...
  const out: GridGroup[] = [];
  for (let i = 0; i < Math.max(l.length, r.length); i++) {
    if (l[i]) out.push(l[i]);
    if (r[i]) out.push(r[i]);
  }
  return out;
}
