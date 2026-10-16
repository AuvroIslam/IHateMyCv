import type { DesignSpec, SourceLayout, SourceLine } from '@/types/cv';
import { readingOrder, textSize } from './reading-order';

/**
 * Fitting the design to the original's measured geometry.
 *
 * The model reads spacing off a text dump and gets it roughly right; roughly
 * right drifts a full line by the bottom of a page. Here every element of the
 * rebuild is matched to the line it came from in the original PDF, and each
 * spacing parameter is corrected by the median error of exactly the gaps it
 * controls. Pure functions: the browser supplies the rendered measurements.
 */

const PT_PER_MM = 72 / 25.4;

/** One line of a rendered element, in points from the page's top-left, y = baseline. */
export interface MeasuredLine {
  y: number;
  x: number;
  xEnd: number;
  /** Letters and digits only: what matching compares. */
  key: string;
}

export interface MeasuredElement {
  role: string;
  page: number;
  /** Section id, when the element sits in a section. */
  section?: string;
  /** Header template row, for header rows. */
  row?: number;
  lines: MeasuredLine[];
}

interface Anchor {
  el: MeasuredElement;
  /** Index into the flattened original lines. */
  at: number;
}

interface FlatLine extends SourceLine {
  page: number;
  key: string;
}

export const normKey = (s: string) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function flatten(layout: SourceLayout): FlatLine[] {
  return layout.pages.flatMap((p, page) =>
    [...p.lines].sort(readingOrder).map((l) => ({ ...l, page, key: normKey(l.text) })),
  );
}

/**
 * Pairs each rendered element with the original line its first line came
 * from, walking both in reading order so repeated text ("Github") pairs up
 * with the right occurrence.
 */
function anchor(elements: MeasuredElement[], lines: FlatLine[]): Anchor[] {
  const out: Anchor[] = [];
  let cursor = 0;
  for (const el of elements) {
    const key = el.lines[0]?.key.slice(0, 18);
    if (!key || key.length < 3) continue;
    let found = -1;
    for (let i = cursor; i < Math.min(lines.length, cursor + 40); i++) {
      if (lines[i].key.startsWith(key)) {
        found = i;
        break;
      }
    }
    // Side-by-side blocks (skill columns, a date beside a title) share a
    // line in the PDF, so a match may sit mid-line.
    if (found < 0) {
      for (let i = cursor; i < Math.min(lines.length, cursor + 8); i++) {
        if (lines[i].key.includes(key)) {
          found = i;
          break;
        }
      }
    }
    if (found < 0) continue;
    out.push({ el, at: found });
    cursor = found;
  }
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Param =
  | 'header.contactTopPt'
  | 'header.spaceBelowPt'
  | 'sectionHeading.spaceBeforePt'
  | 'sectionHeading.spaceAfterPt'
  | 'entry.subtitleGapPt'
  | 'entry.bulletsTopPt'
  | 'entry.bulletSpacingPt'
  | 'entry.spacingPt'
  | 'entry.groupLabel.spaceBeforePt'
  | 'entry.groupLabel.spaceAfterPt'
  | 'skills.lineGapPt';

/** Which spacing parameter owns the gap from an element of role a to one of role b. */
function paramFor(a: string, b: string, design: DesignSpec): Param | null {
  const entryish = ['title', 'subtitle', 'bullet', 'links'];
  if (a === 'name' && b === 'contact') return 'header.contactTopPt';
  // The header's last line - contact, or the name when contacts share its row.
  if ((a === 'contact' || a === 'name') && b === 'heading') return 'header.spaceBelowPt';
  if (b === 'heading') return 'sectionHeading.spaceBeforePt';
  if (a === 'heading') return 'sectionHeading.spaceAfterPt';
  if (a === 'group') return 'entry.groupLabel.spaceAfterPt';
  if (b === 'group' && entryish.includes(a)) return 'entry.groupLabel.spaceBeforePt';
  if (a === 'title' && b === 'subtitle') return 'entry.subtitleGapPt';
  if ((a === 'title' || a === 'subtitle') && (b === 'bullet' || b === 'links')) return 'entry.bulletsTopPt';
  if (a === 'bullet' && (b === 'bullet' || b === 'links')) return 'entry.bulletSpacingPt';
  if (entryish.includes(a) && b === 'title') return 'entry.spacingPt';
  // Between a summary's paragraphs: fitted per section like an entry gap.
  if (a === 'summary' && b === 'summary') return 'entry.spacingPt';
  if (a === 'skill' && b === 'skill' && design.skills.layout !== 'columns') return 'skills.lineGapPt';
  return null;
}

/** Entry gaps that can also be fitted per section, and their SectionSpacing field. */
const SECTION_FIELD = {
  'sectionHeading.spaceBeforePt': 'headingTopPt',
  'entry.spacingPt': 'entryGapPt',
  'entry.bulletsTopPt': 'bulletsTopPt',
  'entry.subtitleGapPt': 'subtitleGapPt',
  'entry.bulletSpacingPt': 'bulletGapPt',
} as const;

function get(design: DesignSpec, path: string): number {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], design) as number;
}

function set(design: DesignSpec, path: string, value: number) {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, design as unknown as Record<string, unknown>);
  target[last] = Math.round(value * 100) / 100;
}

export interface FitReport {
  /** Mean absolute vertical error across matched gaps, in points, before this step. */
  verticalError: number;
  matched: number;
  total: number;
  changes: Record<string, { from: number; to: number }>;
}

/**
 * One correction step. Call repeatedly (re-rendering between calls) until
 * the reported error stops improving.
 */
export function fitStep(input: DesignSpec, layout: SourceLayout, elements: MeasuredElement[]): { design: DesignSpec; report: FitReport } {
  const design = structuredClone(input);
  const lines = flatten(layout);
  const anchors = anchor(elements, lines);
  const changes: FitReport['changes'] = {};
  const change = (path: string, to: number) => {
    const from = get(design, path);
    if (Math.abs(from - to) < 0.01) return;
    changes[path] = { from, to: Math.round(to * 100) / 100 };
    set(design, path, to);
  };
  const origY = (a: Anchor) => lines[a.at].y;
  const rendY = (a: Anchor) => a.el.lines[0].y;

  // --- Vertical: absolute position of the name sets the top margin.
  const name = anchors.find((a) => a.el.role === 'name');
  if (name && name.el.page === 0) {
    const err = origY(name) - rendY(name);
    change('page.marginTop', design.page.marginTop + err / PT_PER_MM);
  }

  // Bottom margin: whatever the model read, every page of the original must
  // fit, or the rebuild breaks pages earlier than the original did.
  {
    const pageH = layout.pages[0].height;
    const lowest = Math.max(...layout.pages.map((p) => Math.max(...p.lines.map((l) => l.y))));
    // Room below the last baseline for descenders.
    const needed = (pageH - lowest - design.font.baseSizePt * 0.3) / PT_PER_MM;
    if (needed < design.page.marginBottom) change('page.marginBottom', Math.max(5, needed));
  }

  // First line of every later page: TeX's own top offset, fitted directly.
  const contErrs: number[] = [];
  for (let page = 1; page < layout.pages.length; page++) {
    const first = anchors.find((a) => a.el.page === page);
    if (first && lines[first.at].page === page && anchors.every((a) => a === first || lines[a.at].page !== page || a.at >= first.at)) {
      contErrs.push(origY(first) - rendY(first));
    }
  }
  const cont = median(contErrs);
  if (cont != null) change('page.continuationTopPt', (design.page.continuationTopPt ?? 0) + cont);

  // Font sizes are printed in the PDF; the model only estimated them.
  const sizeOf = (role: string) => median(anchors.filter((a) => a.el.role === role).map((a) => textSize(lines[a.at])));
  const setSize = (path: string, size: number | null) => {
    if (size != null && size > 4 && Math.abs(get(design, path) - size) > 0.2) change(path, size);
  };
  setSize('header.nameSizePt', sizeOf('name'));
  setSize('header.contactSizePt', sizeOf('contact'));
  setSize('sectionHeading.sizePt', sizeOf('heading'));
  setSize('entry.titleSizePt', sizeOf('title'));
  setSize('entry.subtitleSizePt', sizeOf('subtitle'));
  setSize('entry.bulletSizePt', sizeOf('bullet'));
  setSize('font.baseSizePt', sizeOf('summary') ?? sizeOf('bullet'));

  // Line pitch inside wrapped paragraphs is the line height, directly.
  const pitches: number[] = [];
  anchors.forEach((a, i) => {
    if (!['bullet', 'summary'].includes(a.el.role)) return;
    const next = anchors[i + 1];
    const origLines = next && lines[next.at].page === lines[a.at].page ? next.at - a.at : 0;
    if (origLines >= 2 && origLines === a.el.lines.length) {
      for (let k = a.at + 1; k < next.at; k++) pitches.push(lines[k].y - lines[k - 1].y);
    }
  });
  const pitch = median(pitches);
  if (pitch) change('font.lineHeight', pitch / design.font.baseSizePt);

  // Every consecutive pair of elements on one page, with matching line counts.
  const errors = new Map<Param, number[]>();
  const sectionErrors = new Map<string, number[]>();
  const rowErrors = new Map<number, number>();
  const allErrs: number[] = [];
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (a.el.page !== b.el.page || lines[a.at].page !== lines[b.at].page) continue;
    if (b.at <= a.at) continue; // side by side, not stacked
    // From the bottom of one column to the top of the other is no gap at all.
    // (The header, column 0, does sit above either column.)
    const [ca, cb] = [lines[a.at].col, lines[b.at].col];
    if (ca && cb && ca !== cb) continue;
    if (b.at - a.at !== a.el.lines.length) continue; // wrapped differently: gap not comparable
    const err = origY(b) - origY(a) - (rendY(b) - rendY(a));
    allErrs.push(Math.abs(err));
    // Header rows past the first contact row each own the space above them.
    if (b.el.role === 'contact' && (b.el.row ?? 0) >= 2 && ['name', 'contact'].includes(a.el.role)) {
      rowErrors.set(b.el.row!, err);
      continue;
    }
    const param = paramFor(a.el.role, b.el.role, design);
    if (!param) continue;
    errors.set(param, [...(errors.get(param) ?? []), err]);
    // The gap above a heading belongs to the heading's section; the others
    // only count inside one section.
    const owner = param === 'sectionHeading.spaceBeforePt' ? b.el.section : a.el.section === b.el.section ? a.el.section : undefined;
    if (param in SECTION_FIELD && owner) {
      const key = `${owner}|${param}`;
      sectionErrors.set(key, [...(sectionErrors.get(key) ?? []), err]);
    }
  }
  for (const [param, errs] of errors) {
    const m = median(errs)!;
    change(param, get(design, param) + m);
  }

  const rows = design.header.template?.rows;
  for (const [row, err] of rowErrors) {
    if (!rows?.[row]) continue;
    const current = rows[row].topPt ?? 0;
    const next = Math.round((current + err) * 100) / 100;
    if (Math.abs(next - current) < 0.01) continue;
    rows[row].topPt = next;
    changes[`header.template.rows.${row}.topPt`] = { from: current, to: next };
  }

  // The same gaps again, per section: LaTeX's spacing depends on context, so
  // a section with its own evidence gets its own value.
  for (const [key, errs] of sectionErrors) {
    const [sectionId, param] = key.split('|') as [string, keyof typeof SECTION_FIELD];
    const def = design.sections.find((d) => d.id === sectionId);
    if (!def) continue;
    const field = SECTION_FIELD[param];
    const current = def.spacing?.[field] ?? get(input, param);
    const next = Math.round((current + median(errs)!) * 100) / 100;
    if (Math.abs(next - current) < 0.01) continue;
    def.spacing = { ...def.spacing, [field]: next };
    changes[`sections.${sectionId}.${field}`] = { from: current, to: next };
  }

  // Width, from single-line bullets: they start where the original's start,
  // so any difference at the end is accumulated across their letters - lost
  // kerning, mostly. Spread it per letter; blaming it on the few spaces
  // squeezed them to nothing.
  const perChar: number[] = [];
  anchors.forEach((a, i) => {
    if (a.el.role !== 'bullet' || a.el.lines.length !== 1) return;
    // Skill grids put two columns on one PDF line, so the line's end is not
    // this item's end.
    if (design.sections.find((d) => d.id === a.el.section)?.type === 'skills') return;
    const next = anchors[i + 1];
    if (!next || next.at !== a.at + 1) return; // wrapped in the original
    const chars = a.el.lines[0].key.length;
    if (chars >= 20) perChar.push((lines[a.at].xEnd - a.el.lines[0].xEnd) / chars / design.entry.bulletSizePt);
  });
  const lc = median(perChar);
  if (lc != null && Math.abs(lc) > 0.0005) {
    const current = design.font.letterSpacingEm ?? 0;
    change('font.letterSpacingEm', Math.max(-0.05, Math.min(0.05, current + lc)));
  }
  // Superseded by letter spacing; undo any value an earlier fit left behind.
  if (design.font.wordSpacingPt) change('font.wordSpacingPt', 0);

  // --- Horizontal, straight from the original's coordinates.
  // The left margin is where the leftmost heading starts. Not a median of
  // all left edges: in a two-column CV half of them start mid-page.
  const headingAnchors = anchors.filter((a) => a.el.role === 'heading');
  const leftmost = headingAnchors.length
    ? headingAnchors.reduce((m, a) => (lines[a.at].x < lines[m.at].x ? a : m))
    : anchors.find((a) => ['title', 'summary'].includes(a.el.role));
  const leftEdge = leftmost ? lines[leftmost.at].x : null;
  // Each section measures indents from its own heading, whichever column it is in.
  const sectionLeft = new Map<string, number>();
  for (const a of headingAnchors) if (a.el.section) sectionLeft.set(a.el.section, lines[a.at].x);
  if (leftEdge != null && leftmost) {
    change('page.marginLeft', design.page.marginLeft + (leftEdge - leftmost.el.lines[0].x) / PT_PER_MM);

    // Two columns: where the main column's headings start fixes the side width.
    if (design.layout.type === 'two-column') {
      const sideIds = new Set(design.sections.filter((d) => d.column === 'side').map((d) => d.id));
      const mainHeads = headingAnchors.filter((a) => a.el.section && !sideIds.has(a.el.section));
      const sideHeads = headingAnchors.filter((a) => a.el.section && sideIds.has(a.el.section));
      const probe = design.layout.sideColumn === 'left' ? mainHeads : sideHeads;
      const err = median(probe.map((a) => lines[a.at].x - a.el.lines[0].x));
      if (err != null && Math.abs(err) > 0.5) {
        const contentW = layout.pages[0].width - (design.page.marginLeft + design.page.marginRight) * PT_PER_MM;
        const sidePt = (contentW * design.layout.sideWidthPct) / 100 + (design.layout.sideColumn === 'left' ? err : -err);
        change('layout.sideWidthPct', Math.max(10, Math.min(60, (sidePt / contentW) * 100)));
      }
    }

    // Justified lines (every line of a paragraph but its last) end on the margin.
    const pageW = layout.pages[0].width;
    const rightEnds: number[] = [];
    const sideOnRight = design.layout.type === 'two-column' && design.layout.sideColumn === 'right';
    anchors.forEach((a, i) => {
      if (sideOnRight) return; // the main column's justified edge is not the page margin
      if (!['bullet', 'summary'].includes(a.el.role) || design.font.textAlign !== 'justify') return;
      const next = anchors[i + 1];
      if (!next) return;
      for (let k = a.at; k < next.at - 1; k++) rightEnds.push(lines[k].xEnd);
    });
    const right = median(rightEnds);
    if (right != null) change('page.marginRight', (pageW - right) / PT_PER_MM);

    // Entry indent: titles starting right of their section heading. Each
    // section votes once, so one long indented list (awards rows) cannot
    // indent every other section; a section that differs keeps its own.
    const indentsBySection = new Map<string, number[]>();
    for (const a of anchors) {
      if (a.el.role !== 'title' || !a.el.section || !sectionLeft.has(a.el.section)) continue;
      const list = indentsBySection.get(a.el.section) ?? [];
      list.push(lines[a.at].x - sectionLeft.get(a.el.section)!);
      indentsBySection.set(a.el.section, list);
    }
    const clampIndent = (v: number | null) => (v != null && v > 2 && v < 60 ? Math.round(v * 100) / 100 : 0);
    const sectionIndent = new Map([...indentsBySection].map(([id, xs]) => [id, clampIndent(median(xs))]));
    // The lower median: a value some section actually uses, never the
    // average of two camps.
    const votes = [...sectionIndent.values()].sort((x, y) => x - y);
    const entryIndent = votes.length ? votes[Math.floor((votes.length - 1) / 2)] : 0;
    if (Math.abs((design.entry.indentPt ?? 0) - entryIndent) > 0.3) change('entry.indentPt', entryIndent);
    for (const def of design.sections) {
      const own = sectionIndent.get(def.id);
      const want = own != null && Math.abs(own - entryIndent) > 1.5 ? own : undefined;
      if (want === def.spacing?.entryIndentPt) continue;
      changes[`sections.${def.id}.entryIndentPt`] = { from: def.spacing?.entryIndentPt ?? entryIndent, to: want ?? entryIndent };
      def.spacing = { ...def.spacing, entryIndentPt: want };
    }
    const indentOf = (section?: string) =>
      (section ? design.sections.find((d) => d.id === section)?.spacing?.entryIndentPt : undefined) ?? entryIndent;

    const bulletIndents: number[] = [];
    const textIndents: number[] = [];
    for (const a of anchors.filter((x) => x.el.role === 'bullet')) {
      const line = lines[a.at];
      const runs = line.runs;
      // Bullets sit inside the (possibly indented) entry.
      const base = ((a.el.section ? sectionLeft.get(a.el.section) : undefined) ?? leftEdge) + indentOf(a.el.section);
      if (runs.length >= 2 && /^[•·◦▪∙‣–-]$/u.test(runs[0].text.trim())) {
        bulletIndents.push(runs[0].x - base);
        textIndents.push(runs[1].x - base);
      } else if (/^\s*[•·◦▪∙‣–-]\s/u.test(line.text)) {
        // Glyph and text share a run; a wrapped continuation line shows
        // where the text itself starts.
        bulletIndents.push(line.x - base);
        const next = lines[a.at + 1];
        if (a.el.lines.length > 1 && next && next.page === line.page && !/^\s*[•·◦▪∙‣–-]\s/u.test(next.text)) {
          textIndents.push(next.x - base);
        }
      }
    }
    const bi = median(bulletIndents);
    const ti = median(textIndents);
    if (bi != null) change('entry.bulletIndentPt', bi);
    if (ti != null) change('entry.bulletTextIndentPt', ti);

    // Skills grid: with two equal columns the right one starts at the centre
    // plus half the gap, so the original's right-column x gives the gap
    // directly - no rendering involved.
    if (design.skills.layout === 'columns') {
      const rightStarts = anchors
        .filter((x) => x.el.role === 'skill')
        .flatMap((x) => lines[x.at].runs.map((r) => r.x))
        .filter((x) => x > leftEdge + 100);
      if (rightStarts.length) {
        const pageW = layout.pages[0].width;
        const contentW = pageW - (design.page.marginLeft + design.page.marginRight) * PT_PER_MM;
        const gap = 2 * (Math.min(...rightStarts) - leftEdge - contentW / 2);
        change('skills.columnGapPt', Math.max(0, gap));
      }
    }
  }

  // Separator gaps: measured space either side of standalone glyphs.
  const gapsFor = (role: string) => {
    const gaps: number[] = [];
    for (const a of anchors.filter((x) => x.el.role === role)) {
      const runs = lines[a.at].runs;
      runs.forEach((r, k) => {
        if (k === 0 || k === runs.length - 1 || !/^[•·|◦▪∙‧–—/]$/u.test(r.text.trim())) return;
        gaps.push(r.x - runs[k - 1].xEnd, runs[k + 1].x - r.xEnd);
      });
    }
    return median(gaps);
  };
  const contactGap = gapsFor('contact');
  if (contactGap != null) change('header.contactGapPt', contactGap);
  const linkGap = gapsFor('links');
  if (linkGap != null) change('entry.linkGapPt', linkGap);

  // Letter-spacing of the name: stretch or squeeze to the original's width.
  // Only the name's own runs count - a header can share its line with an
  // email or phone number on the far side.
  if (name) {
    const r = name.el.lines[0];
    const nameRuns = lines[name.at].runs.filter((run) => {
      const k = normKey(run.text);
      return k.length > 0 && r.key.includes(k);
    });
    const letters = r.key.length;
    if (nameRuns.length && letters > 1 && name.el.lines.length === 1) {
      const width = Math.max(...nameRuns.map((x) => x.xEnd)) - Math.min(...nameRuns.map((x) => x.x));
      const delta = (width - (r.xEnd - r.x)) / (letters - 1) / design.header.nameSizePt;
      // Tracking beyond a few hundredths of an em is a measurement error.
      const next = Math.max(-0.05, Math.min(0.3, design.header.nameLetterSpacingEm + delta));
      change('header.nameLetterSpacingEm', next);
    }
  }

  return {
    design,
    report: {
      // Mean, not median: a few badly placed gaps must not hide behind many good ones.
      verticalError: allErrs.length ? allErrs.reduce((n, e) => n + e, 0) / allErrs.length : 0,
      matched: anchors.length,
      total: elements.length,
      changes,
    },
  };
}
