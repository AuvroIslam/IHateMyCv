import type { CareerLibrary, LockedLines, SourceLayout } from '@/types/cv';
import { readingOrder } from './reading-order';

export type { LockedLines };

/**
 * Original line breaks, reused.
 *
 * A browser cannot reproduce TeX's line breaking: TeX hyphenates
 * ("devel-opment") and squeezes word spaces to fit one more word, and when a
 * single line breaks differently the whole paragraph - and everything below
 * it - moves. But bullets are reused verbatim, so for any paragraph whose text
 * is unchanged we can simply print the original's lines. Edited text no
 * longer matches its stored lines and falls back to normal wrapping.
 */

type Glue = LockedLines['glue'][number];

export const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A summary's paragraphs: the text between blank lines. */
export const splitParagraphs = (s: string) =>
  s
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

/** The logical text a set of locked lines prints. */
export function joinLocked({ lines, glue }: LockedLines): string {
  let out = lines[0] ?? '';
  for (let i = 1; i < lines.length; i++) {
    const g = glue[i - 1];
    if (g === 'soft') out = out.replace(/-$/, '') + lines[i];
    else out += g + lines[i];
  }
  return out;
}

/** True when stored lines still print exactly this text. */
export function locksText(text: string, locked: LockedLines | undefined): locked is LockedLines {
  return Boolean(locked && locked.lines.length > 1 && joinLocked(locked) === squash(text));
}

/** A bullet glyph opening a line. PDFs put it in its own run or share one with the text. */
const LEADING_BULLET = /^\s*(?:[•·◦▪∙‣–-]|\d{1,2}[.)])\s+/u;

interface PlainLine {
  text: string;
  /** Printed with a bullet glyph in front. */
  bulleted: boolean;
  /** Text of the bold runs the line opens with, glyph excluded. */
  boldLead: string;
  /** Pieces set apart by tab-like gaps, x in pt from the line's start. */
  cells: { text: string; x: number }[];
}

/** The original's lines in reading order, bullet glyphs stripped off. */
export function sourceLines(layout: SourceLayout): PlainLine[] {
  return layout.pages.flatMap((p) =>
    [...p.lines]
      .sort(readingOrder)
      .map((l) => {
        const bulleted = LEADING_BULLET.test(l.text);
        let boldLead = '';
        for (const r of l.runs) {
          const t = r.text.replace(LEADING_BULLET, '');
          if (!t.trim()) continue;
          if (!r.bold) break;
          boldLead += (boldLead ? ' ' : '') + t.trim();
        }
        // The line text already has correct word spacing; drop only the glyph.
        return { text: squash(l.text.replace(LEADING_BULLET, '')), bulleted, boldLead: squash(boldLead), cells: cellsOf(l) };
      }),
  );
}

/**
 * A line's pieces separated by gaps far wider than a word space - the
 * columns of a table row. Lines without such gaps are one cell.
 */
function cellsOf(line: SourceLayout['pages'][number]['lines'][number]): PlainLine['cells'] {
  const runs = line.runs.filter((r) => r.text.trim() && !LEADING_BULLET.test(`${r.text.trim()} `));
  const cells: PlainLine['cells'] = [];
  let end = -Infinity;
  for (const r of runs) {
    const last = cells[cells.length - 1];
    if (last && r.x - end < line.size * 0.8) last.text = squash(`${last.text}${r.x - end > line.size * 0.12 ? ' ' : ''}${r.text}`);
    else cells.push({ text: squash(r.text), x: r.x });
    end = r.xEnd;
  }
  const x0 = cells[0]?.x ?? 0;
  return cells.map((c) => ({ text: c.text, x: Math.round((c.x - x0) * 10) / 10 }));
}

/**
 * A single original line that prints `text` give or take a few characters
 * set off its baseline (the "st" of a superscript 1st lands on a line of its
 * own). Only for reading a row's cells, never for locking line breaks.
 */
function findRow(text: string, lines: PlainLine[]): PlainLine | null {
  const target = squash(text).replace(/\s/g, '');
  for (const line of lines) {
    const hay = line.text.replace(/\s/g, '');
    if (hay.length < 8 || target.length - hay.length > 4 || target.length < hay.length) continue;
    if (!target.startsWith(hay.slice(0, 4))) continue;
    let i = 0;
    for (const ch of target) if (ch === hay[i]) i++;
    if (i === hay.length) return line;
  }
  return null;
}

/** Cuts `text` where the original's cells start, matching each by its first word. */
function splitCells(text: string, cells: PlainLine['cells']): string[] | null {
  const t = squash(text);
  const starts = [0];
  for (let i = 1; i < cells.length; i++) {
    const word = cells[i].text.split(' ')[0];
    const at = t.indexOf(word, starts[i - 1] + 1);
    if (!word || at < 0) return null;
    starts.push(at);
  }
  const out = starts.map((s, i) => t.slice(s, starts[i + 1] ?? t.length).trim());
  return out.every(Boolean) ? out : null;
}

/**
 * Finds the original lines that print `text`, or null. Each line must be
 * consumed whole, so a match is exact rather than approximate.
 */
export function findLocked(
  text: string,
  lines: PlainLine[],
): { locked: LockedLines | null; bulleted: boolean; boldLead: string; cells: PlainLine['cells'] } | null {
  const target = squash(text);
  if (!target) return null;

  for (let start = 0; start < lines.length; start++) {
    const first = lines[start].text;
    if (!first || !(target.startsWith(first) || (first.endsWith('-') && target.startsWith(first.slice(0, -1))))) continue;

    const out: string[] = [];
    const glue: Glue[] = [];
    let pos = 0;
    let soft = false;
    let ok = true;

    for (let j = start; j < lines.length; j++) {
      const line = lines[j].text;
      if (j > start) {
        if (soft) glue.push('soft');
        else if (target[pos] === ' ') {
          glue.push(' ');
          pos++;
        } else glue.push('');
      }
      if (target.startsWith(line, pos)) {
        pos += line.length;
        soft = false;
      } else if (line.endsWith('-') && target.startsWith(line.slice(0, -1), pos)) {
        // A hyphen the text does not contain: TeX split the word here.
        pos += line.length - 1;
        soft = true;
      } else {
        ok = false;
        break;
      }
      out.push(line);
      if (pos === target.length && !soft) break;
    }

    if (ok && pos === target.length && !soft) {
      return {
        locked: out.length > 1 ? { lines: out, glue } : null,
        bulleted: lines[start].bulleted,
        boldLead: lines[start].boldLead,
        cells: out.length === 1 ? lines[start].cells : [],
      };
    }
  }
  return null;
}

/**
 * Records, on each bullet and summary, how the original broke its lines and
 * whether it carried a bullet glyph. Run once, right after extraction, while
 * the library still matches the PDF word for word.
 */
export function attachSourceLines(library: CareerLibrary, layout: SourceLayout | null): CareerLibrary {
  if (!layout) return library;
  const lines = sourceLines(layout);
  return {
    ...library,
    summaryVariants: library.summaryVariants.map((v) => {
      const paras = splitParagraphs(v.text);
      if (paras.length > 1) {
        const locked = paras.map((p) => findLocked(p, lines)?.locked ?? null);
        return locked.some(Boolean) ? { ...v, paragraphs: locked } : v;
      }
      const m = findLocked(v.text, lines);
      return m?.locked ? { ...v, lines: m.locked } : v;
    }),
    entries: library.entries.map((e) => {
      const found = e.bullets.map((b) => {
        const m = findLocked(b.text, lines);
        if (m) return m;
        const row = findRow(b.text, lines);
        return row ? { locked: null, bulleted: row.bulleted, boldLead: '', cells: row.cells, loose: true } : null;
      });
      // Rows the original printed without glyphs mostly: an unmatched row
      // among them was plain too.
      const matched = found.filter((m) => m !== null);
      const mostlyPlain = matched.length >= 2 && matched.filter((m) => !m.bulleted).length / matched.length >= 0.6;
      const tabs = tabStops(found.map((m) => m?.cells ?? []));

      return {
        ...e,
        bullets: e.bullets.map((b, i) => {
          const m = found[i];
          const plain = m ? !m.bulleted : mostlyPlain;
          const cells = m && tabs && m.cells.length === tabs.length ? splitCells(b.text, m.cells) : null;
          if (!m) return plain ? { ...b, plain: true } : b;
          // A bold lead-in, but not a bullet that is bold throughout.
          const lead =
            !('loose' in m) && m.boldLead && squash(b.text).startsWith(m.boldLead) && m.boldLead.length < squash(b.text).length
              ? m.boldLead
              : '';
          return {
            ...b,
            ...(m.locked ? { lines: m.locked } : {}),
            ...(plain ? { plain: true } : {}),
            ...(lead ? { boldPrefix: lead } : {}),
            ...(cells && tabs ? { cells, tabs } : {}),
          };
        }),
      };
    }),
  };
}

/**
 * Tab stops shared by an entry's table rows: at least two rows split into the
 * same number of cells, starting at the same offsets. Null when the rows are
 * ordinary text.
 */
function tabStops(rows: PlainLine['cells'][]): number[] | null {
  const tabled = rows.filter((r) => r.length >= 2);
  if (tabled.length < 2) return null;
  const counts = new Map<number, number>();
  for (const r of tabled) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
  const [n, k] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (k < 2) return null;
  const same = tabled.filter((r) => r.length === n);
  const stops: number[] = [];
  for (let i = 0; i < n; i++) {
    const xs = same.map((r) => r[i].x).sort((a, b) => a - b);
    if (xs[xs.length - 1] - xs[0] > 3) return null;
    stops.push(xs[Math.floor(xs.length / 2)]);
  }
  return stops;
}
