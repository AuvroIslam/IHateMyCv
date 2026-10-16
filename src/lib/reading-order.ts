import type { SourceLine } from '@/types/cv';

/**
 * Lines of one page in the order they are read: the header, then each column
 * top to bottom. Single-column pages carry no column and read top to bottom.
 */
export function readingOrder(a: Pick<SourceLine, 'x' | 'y' | 'col'>, b: Pick<SourceLine, 'x' | 'y' | 'col'>): number {
  return (a.col ?? 0) - (b.col ?? 0) || a.y - b.y || a.x - b.x;
}

/**
 * The size of a line's text, leaving out runs that are only a glyph or
 * punctuation: a bullet set in a symbol font is often larger than the words
 * after it, and the line's own size is the largest run.
 */
export function textSize(line: Pick<SourceLine, 'size' | 'runs'>): number {
  const sizes = line.runs.filter((r) => /[\p{L}\p{N}]/u.test(r.text)).map((r) => r.size ?? line.size);
  return sizes.length ? Math.max(...sizes) : line.size;
}
