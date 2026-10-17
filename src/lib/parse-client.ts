'use client';

/**
 * Browser-side CV parsing.
 *
 * This deliberately runs in the browser rather than on the server: pdf.js can
 * rasterise pages using the browser's own canvas, so we get page images for the
 * vision pass without pulling in a native canvas binding. The server then only
 * has to deal with text and base64.
 */

import type { SourceLayout, UploadedFont } from '@/types/cv';
import { remapFontToUnicode, unicodeCoverage } from './font-remap';
import { readingOrder } from './reading-order';

export interface ParsedUpload {
  kind: 'pdf' | 'docx' | 'txt';
  fileName: string;
  pageCount: number;
  /** Positioned text runs, one per line, for measuring the design. */
  textDump: string;
  rawText: string;
  /** Base64 page renders (no data: prefix) for the vision pass. */
  images: { mediaType: string; data: string }[];
  /** The PDF's embedded fonts, remapped so the browser can type with them. */
  fonts: UploadedFont[];
  /** Where every line sat on the original, for auto-alignment. Null without layout info. */
  layout: SourceLayout | null;
}

/** Runs set in an icon font, or made only of private-use or emoji characters. */
export function isIconRun(fontName: string, text: string): boolean {
  if (/awesome|icon|symbol|dingbat|wingding|emoji|marvosym|academicons/i.test(fontName.replace(/^[A-Z]{6}\+/, ''))) {
    return true;
  }
  return /^[\s-☀-➿\u{1F000}-\u{1FAFF}]+$/u.test(text);
}

/**
 * Bold/italic from a PDF font name. LaTeX's names are terse (CMBX10 is bold
 * extended, CMTI10 text italic, CMSL slanted), so plain "bold"/"italic"
 * matching misses every one of them.
 */
export function fontFlags(name: string) {
  const n = name.replace(/^[A-Z]{6}\+/, '');
  return {
    bold: /bold|black|heavy|semib|demi|[-_,]b\b|^cmbx|^cmb\d|^sfbx|^cmssbx|^sfsx|^lmroman\w*-bold/i.test(n),
    italic: /italic|oblique|[-_,]i\b|^cmti|^cmbxti|^cmsl|^cmbxsl|^sfti|^sfsl|^sfbi|^cmssi/i.test(n),
  };
}

const MAX_VISION_PAGES = 3;
/** Share of a font's own characters it must draw after remapping to be used. */
const MIN_FONT_COVERAGE = 0.9;
const MAX_DUMP_LINES_PER_PAGE = 260;

type PdfModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfModule> | null = null;

async function loadPdfjs(): Promise<PdfModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((mod) => {
      // The worker is copied into /public by the `sync-pdf-worker` script.
      mod.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return mod;
    });
  }
  return pdfjsPromise;
}

export interface Run {
  x: number;
  /** Exact end of the run: pdf.js reports each run's advance width. */
  xEnd: number;
  y: number;
  size: number;
  font: string;
  text: string;
  bold: boolean;
  italic: boolean;
}

export async function parseUpload(file: File): Promise<ParsedUpload> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.pdf')) return parsePdf(file);
  if (lower.endsWith('.docx')) return parseDocx(file);
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return parseText(file);
  throw new Error('Unsupported file type. Upload a PDF, DOCX, TXT or MD file.');
}

async function parsePdf(file: File): Promise<ParsedUpload> {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  // fontExtraProperties keeps each font's code -> Unicode maps, which the
  // remapping below needs.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), fontExtraProperties: true }).promise;

  const dumpParts: string[] = [];
  const rawParts: string[] = [];
  const images: ParsedUpload['images'] = [];
  const fontUse = new Map<string, FontUse>();
  const layout: SourceLayout = { pages: [] };

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    // Loads the page's fonts. Without this, font names resolve only after a
    // render, so page 1 reached the model as ids like "g_d0_f1" instead of
    // "CMR10" - leaving it nothing to match the typeface on.
    const ops = await page.getOperatorList();
    const hyphens = softHyphens(ops, pdfjs.OPS.showText);
    const content = await page.getTextContent();

    const runs: Run[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const t = item.transform as number[];
      const size = Math.hypot(t[2], t[3]) || item.height || 0;
      const fontName = resolveFontName(page, item.fontName);
      // Icons are decoration. Their text is a glyph name ("HOUSE-CHIMNEY") or
      // a private-use character, and would leak into labels and line matching.
      if (isIconRun(fontName, item.str)) continue;
      const str = hyphens.length ? restoreHyphens(item.str, hyphens) : item.str;
      // Through the viewport rather than `height - y`, so pages whose box does
      // not start at 0,0 still line up with the link rectangles below.
      const [vx, vy] = viewport.convertToViewportPoint(t[4], t[5]) as [number, number];
      runs.push({
        x: round(vx),
        xEnd: round(vx + (item.width || 0)),
        y: round(vy),
        size: round(size),
        font: fontName,
        text: str,
        ...fontFlags(fontName),
      });
      recordFontUse(fontUse, page, item.fontName, round(size), str);
    }

    const lines = splitColumns(groupIntoLines(runs), viewport.width, viewport.height);
    const marks = drawnMarks(ops, pdfjs, viewport);
    markDrawnBullets(lines, marks.dots);
    const columns = lines.some((l) => l.col);
    rawParts.push(lines.map((l) => l.text).join('\n'));

    dumpParts.push(
      `--- PAGE ${pageNo} (${round(viewport.width)}x${round(viewport.height)}pt) ---`,
    );
    if (columns) {
      dumpParts.push('TWO COLUMNS: the header lines come first, then the whole left column top to bottom, then the whole right column.');
    }
    for (const line of lines.slice(0, MAX_DUMP_LINES_PER_PAGE)) {
      const flags = [line.bold ? 'bold' : '', line.italic ? 'italic' : ''].filter(Boolean).join('+');
      dumpParts.push(
        `x=${line.x} y=${line.y} size=${line.size} font=${line.font}${flags ? ` (${flags})` : ''} | ${line.text}`,
      );
    }
    if (lines.length > MAX_DUMP_LINES_PER_PAGE) {
      dumpParts.push(`... ${lines.length - MAX_DUMP_LINES_PER_PAGE} more lines on this page`);
    }

    const gaps = lines.flatMap((l) => separatorGaps(l).map((g) => ({ ...g, y: l.y })));
    if (gaps.length) {
      dumpParts.push(`SEPARATOR GAPS ON PAGE ${pageNo} (measured space either side of each standalone separator, in pt):`);
      for (const g of gaps) dumpParts.push(`y=${g.y} "${g.glyph}" left=${g.left} right=${g.right}`);
    }

    layout.pages.push({
      width: round(viewport.width),
      height: round(viewport.height),
      ...(marks.rules.length ? { rules: marks.rules } : {}),
      lines: lines.map((l) => ({
        x: l.x,
        xEnd: round(l.endX),
        y: l.y,
        size: l.size,
        text: l.text,
        ...(l.col != null ? { col: l.col } : {}),
        runs: l.runs.map((r) => ({
          x: r.x,
          xEnd: r.xEnd,
          text: r.text,
          ...(r.bold ? { bold: true } : {}),
          ...(r.italic ? { italic: true } : {}),
          ...(r.size !== l.size ? { size: r.size } : {}),
        })),
      })),
    });

    // URLs live in link annotations laid over the text, not in the text
    // itself, so "LinkedIn" or "Live Link" arrive with no target unless they
    // are paired up here.
    const links = await extractLinks(page, viewport, runs);
    if (links.length) {
      dumpParts.push(`LINKS ON PAGE ${pageNo} (clickable text -> target; y = baseline of that text):`);
      for (const l of links) dumpParts.push(`y=${l.y} x=${l.x} "${l.text}" -> ${l.url}`);
    }

    if (pageNo <= MAX_VISION_PAGES) {
      images.push(await renderPage(page, viewport));
    }
    page.cleanup();
  }

  return {
    kind: 'pdf',
    fileName: file.name,
    pageCount: doc.numPages,
    textDump: dumpParts.join('\n'),
    rawText: rawParts.join('\n\n'),
    images,
    fonts: packFonts(fontUse),
    layout,
  };
}

// ---------------------------------------------------------------------------
// Embedded fonts

interface PdfFont {
  name?: string;
  data?: Uint8Array;
  mimetype?: string;
  isType3Font?: boolean;
  missingFile?: boolean;
  bold?: boolean;
  italic?: boolean;
  /** pdf.js's ToUnicodeMap / IdentityToUnicodeMap after crossing the worker boundary. */
  toUnicode?: { _map?: (string | undefined)[]; firstChar?: number; lastChar?: number };
  toFontChar?: number[];
}

interface FontUse {
  font: PdfFont;
  chars: Set<number>;
  bySize: Map<number, number>;
}

function recordFontUse(use: Map<string, FontUse>, page: unknown, ref: string | undefined, size: number, text: string) {
  if (!ref) return;
  let entry = use.get(ref);
  if (!entry) {
    const objs = (page as { commonObjs?: { has(k: string): boolean; get(k: string): unknown } }).commonObjs;
    if (!objs?.has(ref)) return;
    entry = { font: objs.get(ref) as PdfFont, chars: new Set(), bySize: new Map() };
    use.set(ref, entry);
  }
  let n = 0;
  for (const ch of text) {
    if (ch.trim()) {
      entry.chars.add(ch.codePointAt(0)!);
      n++;
    }
  }
  entry.bySize.set(size, (entry.bySize.get(size) ?? 0) + n);
}

/** Unicode code point -> the code the converted font's cmap is keyed by. */
function unicodeToFontCode(font: PdfFont): Map<number, number> {
  const out = new Map<number, number>();
  const toFontChar = font.toFontChar ?? [];
  const map = font.toUnicode;
  const add = (code: number, unicode: string | undefined) => {
    // Multi-character entries are ligatures ("fi"); browsers only reach those
    // through OpenType features, so they cannot be mapped here.
    if (typeof unicode !== 'string' || Array.from(unicode).length !== 1) return;
    const cp = unicode.codePointAt(0)!;
    if (!out.has(cp)) out.set(cp, toFontChar[code] ?? code);
  };
  if (map?._map) {
    map._map.forEach((u, code) => add(code, u));
  } else if (typeof map?.firstChar === 'number' && typeof map.lastChar === 'number') {
    for (let c = map.firstChar; c <= map.lastChar; c++) add(c, String.fromCodePoint(c));
  }
  return out;
}

/**
 * Each font that survives remapping and covers its own text. Anything that
 * fails is simply left out: the renderer then uses the catalogue match, which
 * is exactly what happened before fonts were extracted at all.
 */
function packFonts(use: Map<string, FontUse>): UploadedFont[] {
  const out: UploadedFont[] = [];
  let i = 0;
  for (const { font, chars, bySize } of use.values()) {
    if (!font.data || font.isType3Font || font.missingFile || chars.size === 0) continue;
    // Only characters this font actually drew. A subset font keeps blank
    // slots for the rest of its encoding, and mapping those would print an
    // empty box where the browser should fall back to the matched web font.
    // Spaces are never recorded as drawn but are real glyphs where present.
    const drawn = new Map([...unicodeToFontCode(font)].filter(([cp]) => chars.has(cp) || cp === 0x20 || cp === 0xa0));
    const result = remapFontToUnicode(new Uint8Array(font.data), drawn);
    if (!result.ok) continue;

    const covered = unicodeCoverage(result.font);
    const hits = Array.from(chars).filter((c) => covered.has(c)).length;
    if (hits / chars.size < MIN_FONT_COVERAGE) continue;

    const name = (font.name ?? 'font').replace(/^[A-Z]{6}\+/, '');
    const flags = fontFlags(name);
    out.push({
      id: `f${i++}`,
      name,
      bold: flags.bold || Boolean(font.bold),
      italic: flags.italic || Boolean(font.italic),
      // 'OTTO' marks CFF outlines; everything else pdf.js emits is TrueType.
      format: String.fromCharCode(...result.font.subarray(0, 4)) === 'OTTO' ? 'otf' : 'ttf',
      data: toBase64(result.font),
      usage: Array.from(bySize, ([size, chars]) => ({ size, chars })),
    });
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function resolveFontName(page: unknown, fontRef: string | undefined): string {
  if (!fontRef) return 'unknown';
  try {
    const objs = (page as { commonObjs?: { has(k: string): boolean; get(k: string): unknown } })
      .commonObjs;
    if (objs?.has(fontRef)) {
      const font = objs.get(fontRef) as { name?: string } | undefined;
      // Embedded names are often subset-tagged, e.g. "ABCDEF+NimbusRoman-Regular".
      if (font?.name) return font.name.replace(/^[A-Z]{6}\+/, '');
    }
  } catch {
    // pdf.js throws if the font object has not resolved yet; the ref is still
    // useful as a grouping key.
  }
  return fontRef;
}

interface FoundLink {
  x: number;
  y: number;
  text: string;
  url: string;
}

export async function extractLinks(
  page: import('pdfjs-dist').PDFPageProxy,
  viewport: import('pdfjs-dist').PageViewport,
  runs: Run[],
): Promise<FoundLink[]> {
  let annotations: unknown[];
  try {
    annotations = await page.getAnnotations({ intent: 'display' });
  } catch {
    return [];
  }

  const found: FoundLink[] = [];
  for (const raw of annotations) {
    const a = raw as { subtype?: string; url?: string; unsafeUrl?: string; rect?: number[] };
    const url = a.url ?? a.unsafeUrl;
    if (a.subtype !== 'Link' || !url || !a.rect) continue;

    // Into the same top-left space the text runs use.
    const [x1, y1] = viewport.convertToViewportPoint(a.rect[0], a.rect[1]) as [number, number];
    const [x2, y2] = viewport.convertToViewportPoint(a.rect[2], a.rect[3]) as [number, number];
    const left = Math.min(x1, x2) - 2;
    const right = Math.max(x1, x2) + 2;
    const top = Math.min(y1, y2) - 2;
    const bottom = Math.max(y1, y2) + 3;

    const under = runs
      .filter((r) => r.x >= left && r.x <= right && r.y >= top && r.y <= bottom)
      .sort((p, q) => p.y - q.y || p.x - q.x);
    const text = under.map((r) => r.text).join(' ').replace(/\s+/g, ' ').trim();

    found.push({
      x: round(under[0]?.x ?? left),
      y: round(under[0]?.y ?? bottom),
      text: text || '(no text under this link)',
      url,
    });
  }

  // Nearby duplicate rectangles (one per line of a wrapped link) collapse.
  return found
    .filter((l, i) => found.findIndex((m) => m.url === l.url && m.text === l.text && Math.abs(m.y - l.y) < 1) === i)
    .sort((p, q) => p.y - q.y || p.x - q.x);
}

interface Line extends Run {
  endX: number;
  runs: Run[];
  col?: number;
}

/** A horizontal line drawn on the page (a section rule), in viewport points. */
export interface DrawnRule {
  x0: number;
  x1: number;
  y: number;
  thickness: number;
  color?: string;
}

/**
 * Shapes the text layer cannot see, found by following the drawing's
 * transforms to page coordinates:
 * - dots: bullets drawn as tiny filled paths (Google Docs and some Word
 *   exports), so the text has no "•" and every bulleted line would read as plain;
 * - rules: thin horizontal lines and bars - section rules, whose place
 *   relative to the headings the page images alone leave ambiguous, and
 *   underlines, which give away how links are styled and in what colour.
 */
function drawnMarks(
  ops: { fnArray: number[]; argsArray: unknown[] },
  pdfjs: PdfModule,
  viewport: { convertToViewportPoint(x: number, y: number): number[] },
): { dots: { x: number; y: number }[]; rules: DrawnRule[] } {
  const { OPS, Util } = pdfjs;
  const fills = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const strokes = new Set([OPS.stroke, OPS.closeStroke]);
  type M = [number, number, number, number, number, number];
  interface State {
    ctm: M;
    fill?: string;
    stroke?: string;
    lineWidth: number;
  }
  let st: State = { ctm: [1, 0, 0, 1, 0, 0], lineWidth: 1 };
  const stack: State[] = [];
  const dots: { x: number; y: number }[] = [];
  const rules: DrawnRule[] = [];
  const toPage = (x: number, y: number) => {
    const p = [x, y];
    Util.applyTransform(p, st.ctm); // in place
    return viewport.convertToViewportPoint(p[0], p[1]);
  };
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push({ ...st });
    else if (fn === OPS.restore) st = stack.pop() ?? st;
    else if (fn === OPS.transform) st = { ...st, ctm: Util.transform(st.ctm, args as M) as M };
    else if (fn === OPS.setFillRGBColor) st = { ...st, fill: String(args[0]) };
    else if (fn === OPS.setStrokeRGBColor) st = { ...st, stroke: String(args[0]) };
    else if (fn === OPS.setLineWidth) st = { ...st, lineWidth: Number(args[0]) || 1 };
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ...st });
      if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) st = { ...st, ctm: Util.transform(st.ctm, Array.from(args[0] as number[]) as M) as M };
    } else if (fn === OPS.paintFormXObjectEnd) st = stack.pop() ?? st;
    else if (fn === OPS.constructPath) {
      const paint = args[0] as number;
      const box = args[2] as ArrayLike<number> | undefined;
      if (!box || box.length !== 4 || (!fills.has(paint) && !strokes.has(paint))) return;
      const scale = Math.hypot(st.ctm[0], st.ctm[1]);
      const w = (box[2] - box[0]) * scale;
      const h = (box[3] - box[1]) * scale;
      const [ax, ay] = toPage(box[0], (box[1] + box[3]) / 2);
      const [bx] = toPage(box[2], (box[1] + box[3]) / 2);
      // A list dot: small, roughly square.
      if (fills.has(paint) && w >= 1.2 && h >= 1.2 && w <= 7 && h <= 7 && Math.abs(w - h) <= 1.5) {
        dots.push({ x: round((ax + bx) / 2), y: round(ay) });
        return;
      }
      // A rule or an underline: flat, stroked or filled. Section rules span
      // the page; underlines run the width of a word or two.
      if (w > 8 && (strokes.has(paint) ? h <= 1 : h <= 2.5)) {
        rules.push({
          x0: round(Math.min(ax, bx)),
          x1: round(Math.max(ax, bx)),
          y: round(ay),
          thickness: round(Math.max(0.3, strokes.has(paint) ? st.lineWidth * scale : h)),
          color: strokes.has(paint) ? st.stroke : st.fill,
        });
      }
    }
  });
  return { dots, rules };
}

/**
 * Puts a "•" in front of the text each drawn dot sits beside, as if it had
 * been typed: at the start of a line, or mid-line where a second column's
 * item begins.
 */
function markDrawnBullets(lines: Line[], dots: { x: number; y: number }[]) {
  if (!dots.length) return;
  lines.forEach((line, i) => {
    // At about the middle of the line's lowercase letters.
    const near = dots.filter((d) => Math.abs(d.y - (line.y - line.size * 0.3)) < line.size * 0.5);
    if (!near.length) return;
    const runs = [...line.runs];
    let added = false;
    for (const d of near) {
      // The run the dot introduces: the first one starting just right of it.
      const k = runs.findIndex((r) => r.x > d.x && r.x - d.x < 25);
      if (k < 0 || (k > 0 && runs[k - 1].xEnd > d.x)) continue; // inside other text: not a list dot
      if (/^\s*[•·◦▪∙‣–-]/u.test(runs[k].text) || (k > 0 && runs[k - 1].text.trim() === '•')) continue;
      runs.splice(k, 0, { ...runs[k], x: round(d.x - 1.5), xEnd: round(d.x + 1.5), text: '•', bold: false, italic: false });
      added = true;
    }
    if (added) lines[i] = { ...toLine(runs), col: line.col };
  });
}

interface HyphenFix {
  before: string;
  after: string;
}

/**
 * Hyphens drawn with a glyph the font maps to U+00AD. Some fonts (Source Sans
 * under XeLaTeX, as in Awesome-CV) map their only hyphen there, and pdf.js
 * drops U+00AD from extracted text as an invisible mark - so "Shin-Il" reads
 * "ShinIl" and "Back-end" reads "Backend". The drawing operations still hold
 * the glyph: each one is recorded with the letters either side, spaces
 * ignored (TeX sets spaces as offsets, not characters), to put it back.
 */
function softHyphens(ops: { fnArray: number[]; argsArray: unknown[] }, showText: number): HyphenFix[] {
  const out: HyphenFix[] = [];
  ops.fnArray.forEach((fn, i) => {
    if (fn !== showText) return;
    const glyphs = (ops.argsArray[i] as unknown[][])[0] ?? [];
    const text = glyphs.map((g) => (g && typeof g === 'object' ? ((g as { unicode?: string }).unicode ?? '') : '')).join('');
    for (let k = text.indexOf('\u00ad'); k >= 0; k = text.indexOf('\u00ad', k + 1)) {
      const before = text.slice(0, k).replace(/[\s\u00ad]/g, '').slice(-8);
      const after = text.slice(k + 1).replace(/[\s\u00ad]/g, '').slice(0, 8);
      if (before.length >= 2) out.push({ before, after });
    }
  });
  return out;
}

function restoreHyphens(str: string, fixes: HyphenFix[]): string {
  for (const { before, after } of fixes) {
    // Positions of the non-space characters, to map a match back into `str`.
    const at: number[] = [];
    let compact = '';
    for (let i = 0; i < str.length; i++) {
      if (/\s/.test(str[i])) continue;
      at.push(i);
      compact += str[i];
    }
    const key = before + after;
    const found = after ? compact.indexOf(key) : compact.endsWith(key) ? compact.length - key.length : -1;
    if (found < 0) continue;
    const cut = found + before.length;
    const pos = cut < at.length ? at[cut] : str.length;
    // Directly after the letter before it, ahead of any space.
    const insertAt = at[cut - 1] + 1;
    if (str[insertAt] === '-' || pos < insertAt) continue;
    str = `${str.slice(0, insertAt)}-${str.slice(insertAt)}`;
  }
  return str;
}

/**
 * Merge text runs sharing a baseline into readable lines. Runs are clustered
 * by baseline first and only then ordered left to right, so a run sitting a
 * fraction of a point off the baseline cannot land out of order.
 */
function groupIntoLines(runs: Run[]): Line[] {
  const byY = [...runs].sort((a, b) => a.y - b.y);
  const clusters: Run[][] = [];
  for (const run of byY) {
    const current = clusters[clusters.length - 1];
    if (current && run.y - current[0].y <= 2.2) current.push(run);
    else clusters.push([run]);
  }
  return clusters.map(toLine).filter((l) => l.text);
}

function toLine(cluster: Run[]): Line {
  const ordered = [...cluster].sort((a, b) => a.x - b.x);
  let text = '';
  let endX = -Infinity;
  for (const run of ordered) {
    // Widths are exact, so any visible gap is a word space.
    if (text && run.x - endX > run.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(run.text)) text += ' ';
    text += run.text;
    endX = Math.max(endX, run.xEnd);
  }
  const main = ordered.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  return {
    ...ordered[0],
    y: main.y,
    size: Math.max(...ordered.map((r) => r.size)),
    font: main.font,
    bold: ordered.some((r) => r.bold),
    italic: ordered.some((r) => r.italic),
    text: text.replace(/\s+/g, ' ').trim(),
    endX,
    runs: ordered,
  };
}

/**
 * Two independent columns share a PDF baseline wherever their lines happen to
 * line up, and the merged line reads as nonsense ("CORNELL UNIVERSITY
 * COURSERA | KPCB Fellow"). This finds a gutter no body text crosses and
 * splits every line at it, so each column reads top to bottom on its own,
 * after the header that spans them.
 *
 * A date column beside the body (moderncv) also leaves a clear gutter, but
 * its lines pair with the body's one for one: that is a table, and stays
 * merged.
 */
export function splitColumns(lines: Line[], width: number, height: number): Line[] {
  const gutter = findGutter(lines, width);
  if (gutter == null) return lines;
  const leftOnly = lines.filter((l) => l.runs.every((r) => r.xEnd <= gutter));
  const rightOnly = lines.filter((l) => l.runs.every((r) => r.x >= gutter));
  if (!leftOnly.length || !rightOnly.length) return lines;
  // The header ends with the last line near the top that spans the gutter
  // (the name, a centred contact line); lines above it on one side only
  // ("Last updated") are header too. Without such a line, the columns start
  // where both have begun.
  const spanning = lines.filter((l) => l.y < height * 0.3 && l.runs.some((r) => r.x < gutter && r.xEnd > gutter));
  let top: number;
  if (spanning.length) {
    top = Math.max(...spanning.map((l) => l.y)) + 1;
    // Lines set close under it continue the header (a second contact line).
    let prev = spanning.reduce((a, b) => (b.y > a.y ? b : a));
    for (const l of [...lines].sort((a, b) => a.y - b.y)) {
      if (l.y < top) continue;
      if (l.y - prev.y > Math.max(l.size, prev.size) * 1.6) break;
      top = l.y + 1;
      prev = l;
    }
  } else {
    const leftTop = Math.min(...lines.filter((l) => l.runs.some((r) => r.xEnd <= gutter)).map((l) => l.y));
    const rightTop = Math.min(...lines.filter((l) => l.runs.some((r) => r.x >= gutter)).map((l) => l.y));
    top = Math.max(leftTop, rightTop) - 2;
  }

  const out: Line[] = [];
  for (const line of lines) {
    const left = line.runs.filter((r) => r.xEnd <= gutter);
    const right = line.runs.filter((r) => r.x >= gutter);
    if (line.y < top) {
      out.push({ ...line, col: 0 });
      continue;
    }
    // Spans the gutter below the header (a chart label): kept whole, read
    // with the column it starts in.
    if (left.length + right.length < line.runs.length) {
      out.push({ ...line, col: line.x < gutter ? 1 : 2 });
      continue;
    }
    if (left.length) out.push({ ...toLine(left), col: 1 });
    if (right.length) out.push({ ...toLine(right), col: 2 });
  }
  return out.filter((l) => l.text).sort(readingOrder);
}

function findGutter(lines: Line[], width: number): number | null {
  if (lines.length < 12) return null;
  const CLEAR = 4;
  const fits = (x: number) => {
    let crossing = 0;
    let left = 0;
    let right = 0;
    let both = 0;
    for (const l of lines) {
      if (l.runs.some((r) => r.x < x + CLEAR && r.xEnd > x - CLEAR)) {
        crossing++;
        continue;
      }
      const L = l.runs.some((r) => r.xEnd <= x);
      const R = l.runs.some((r) => r.x >= x);
      if (L && R) both++;
      else if (L) left++;
      else right++;
    }
    return (
      // A few header lines may span the gutter; body text may not.
      crossing <= Math.max(3, lines.length * 0.08) &&
      left + both >= 8 &&
      right + both >= 8 &&
      // Independent columns rarely share a baseline; a table's do on every row.
      both < 0.5 * (Math.min(left, right) + both)
    );
  };
  let best: [number, number] | null = null;
  let start: number | null = null;
  for (let x = Math.round(width * 0.2); x <= Math.round(width * 0.8) + 1; x++) {
    const ok = x <= width * 0.8 && fits(x);
    if (ok && start == null) start = x;
    if (!ok && start != null) {
      if (!best || x - start > best[1] - best[0]) best = [start, x - 1];
      start = null;
    }
  }
  return best ? (best[0] + best[1]) / 2 : null;
}

const SEPARATOR = /^[•·|◦▪∙‧–—/]$/u;

/**
 * Space on each side of standalone separator glyphs ("•", "|") in a line.
 * LaTeX sets these as measured space, so only coordinates can recover it.
 */
function separatorGaps(line: Line): { glyph: string; left: number; right: number }[] {
  const out: { glyph: string; left: number; right: number }[] = [];
  line.runs.forEach((run, i) => {
    const glyph = run.text.trim();
    if (!SEPARATOR.test(glyph) || i === 0 || i === line.runs.length - 1) return;
    const prev = line.runs[i - 1];
    const next = line.runs[i + 1];
    out.push({ glyph, left: round(run.x - prev.xEnd), right: round(next.x - run.xEnd) });
  });
  return out;
}

async function renderPage(
  page: import('pdfjs-dist').PDFPageProxy,
  baseViewport: { width: number; height: number },
): Promise<{ mediaType: string; data: string }> {
  // ~1400px on the long edge: enough for the model to read type and rules,
  // small enough to keep the request light.
  const scale = Math.min(2.5, 1400 / baseViewport.height);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a canvas to render the PDF.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  return { mediaType: 'image/jpeg', data: dataUrl.split(',')[1] };
}

async function parseDocx(file: File): Promise<ParsedUpload> {
  const mod = (await import('mammoth/mammoth.browser.js')) as unknown as {
    default?: { convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> };
    convertToHtml?(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
  };
  const mammoth = mod.default ?? (mod as Required<typeof mod>);
  const buf = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lines: string[] = [];
  doc.body.querySelectorAll('h1,h2,h3,h4,p,li').forEach((el) => {
    const text = el.textContent?.replace(/\s+/g, ' ').trim();
    if (!text) return;
    const tag = el.tagName.toLowerCase();
    const bold = Boolean(el.querySelector('strong')) || tag.startsWith('h');
    lines.push(`tag=${tag}${bold ? ' (bold)' : ''} | ${text}`);
  });

  const links = Array.from(doc.body.querySelectorAll('a[href]'))
    .map((a) => ({ text: a.textContent?.replace(/\s+/g, ' ').trim() ?? '', url: a.getAttribute('href') ?? '' }))
    .filter((l) => l.url && !l.url.startsWith('#'));

  const rawText = doc.body.textContent?.replace(/\n{3,}/g, '\n\n').trim() ?? '';
  return {
    kind: 'docx',
    fileName: file.name,
    pageCount: Math.max(1, Math.ceil(rawText.length / 3200)),
    fonts: [],
    layout: null,
    textDump: [
      '--- DOCX STRUCTURE (no coordinates available) ---',
      ...lines,
      ...(links.length
        ? ['LINKS (clickable text -> target, in document order):', ...links.map((l) => `"${l.text}" -> ${l.url}`)]
        : []),
    ].join('\n'),
    rawText,
    images: [],
  };
}

async function parseText(file: File): Promise<ParsedUpload> {
  const rawText = await file.text();
  return {
    kind: 'txt',
    fileName: file.name,
    pageCount: Math.max(1, Math.ceil(rawText.length / 3200)),
    textDump: ['--- PLAIN TEXT (no layout information available) ---', rawText].join('\n'),
    rawText,
    images: [],
    fonts: [],
    layout: null,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
