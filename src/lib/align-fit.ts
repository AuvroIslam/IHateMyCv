import type { DesignSpec, SourceLayout, SourceLine } from '@/types/cv';

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
    [...p.lines].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => ({ ...l, page, key: normKey(l.text) })),
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
  if (a === 'contact' && b === 'heading') return 'header.spaceBelowPt';
  if (b === 'heading') return 'sectionHeading.spaceBeforePt';
  if (a === 'heading') return 'sectionHeading.spaceAfterPt';
  if (a === 'group') return 'entry.groupLabel.spaceAfterPt';
  if (b === 'group' && entryish.includes(a)) return 'entry.groupLabel.spaceBeforePt';
  if (a === 'title' && b === 'subtitle') return 'entry.subtitleGapPt';
  if ((a === 'title' || a === 'subtitle') && (b === 'bullet' || b === 'links')) return 'entry.bulletsTopPt';
  if (a === 'bullet' && (b === 'bullet' || b === 'links')) return 'entry.bulletSpacingPt';
  if (entryish.includes(a) && b === 'title') return 'entry.spacingPt';
  if (a === 'skill' && b === 'skill' && design.skills.layout !== 'columns') return 'skills.lineGapPt';
  return null;
}

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
  /** Median absolute vertical error across matched gaps, in points, before this step. */
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
  const allErrs: number[] = [];
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (a.el.page !== b.el.page || lines[a.at].page !== lines[b.at].page) continue;
    if (b.at <= a.at) continue; // side by side, not stacked
    if (b.at - a.at !== a.el.lines.length) continue; // wrapped differently: gap not comparable
    const err = origY(b) - origY(a) - (rendY(b) - rendY(a));
    allErrs.push(Math.abs(err));
    const param = paramFor(a.el.role, b.el.role, design);
    if (!param) continue;
    errors.set(param, [...(errors.get(param) ?? []), err]);
  }
  for (const [param, errs] of errors) {
    const m = median(errs)!;
    change(param, get(design, param) + m);
  }

  // --- Horizontal, straight from the original's coordinates.
  const leftEdge = median(
    anchors.filter((a) => ['heading', 'title', 'summary'].includes(a.el.role)).map((a) => lines[a.at].x),
  );
  if (leftEdge != null) {
    const rendLeft = median(
      anchors.filter((a) => ['heading', 'title', 'summary'].includes(a.el.role)).map((a) => a.el.lines[0].x),
    )!;
    change('page.marginLeft', design.page.marginLeft + (leftEdge - rendLeft) / PT_PER_MM);

    // Justified lines (every line of a paragraph but its last) end on the margin.
    const pageW = layout.pages[0].width;
    const rightEnds: number[] = [];
    anchors.forEach((a, i) => {
      if (!['bullet', 'summary'].includes(a.el.role) || design.font.textAlign !== 'justify') return;
      const next = anchors[i + 1];
      if (!next) return;
      for (let k = a.at; k < next.at - 1; k++) rightEnds.push(lines[k].xEnd);
    });
    const right = median(rightEnds);
    if (right != null) change('page.marginRight', (pageW - right) / PT_PER_MM);

    // Bullet glyph and hanging text, from the first bullet's runs.
    const bulletIndents: number[] = [];
    const textIndents: number[] = [];
    for (const a of anchors.filter((x) => x.el.role === 'bullet')) {
      const runs = lines[a.at].runs;
      if (runs.length >= 2 && /^[•·◦▪∙‣–-]$/u.test(runs[0].text.trim())) {
        bulletIndents.push(runs[0].x - leftEdge);
        textIndents.push(runs[1].x - leftEdge);
      }
    }
    const bi = median(bulletIndents);
    const ti = median(textIndents);
    if (bi != null && ti != null) {
      change('entry.bulletIndentPt', bi);
      change('entry.bulletTextIndentPt', ti);
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
  if (name) {
    const o = lines[name.at];
    const r = name.el.lines[0];
    const letters = name.el.lines[0].key.length;
    if (letters > 1 && name.el.lines.length === 1) {
      const delta = (o.xEnd - o.x - (r.xEnd - r.x)) / (letters - 1) / design.header.nameSizePt;
      change('header.nameLetterSpacingEm', design.header.nameLetterSpacingEm + delta);
    }
  }

  return {
    design,
    report: {
      verticalError: median(allErrs) ?? 0,
      matched: anchors.length,
      total: elements.length,
      changes,
    },
  };
}
