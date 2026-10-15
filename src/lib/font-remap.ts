/**
 * Rewrites the character map of a font embedded in a PDF so the browser can
 * type ordinary Unicode text with it.
 *
 * A PDF font is addressed by the PDF's own character codes, not by Unicode:
 * LaTeX's Computer Modern puts an en dash at code 123, for instance. pdf.js
 * converts every embedded font into an OpenType file keyed by those codes.
 * Given pdf.js's code -> Unicode map, this swaps in a Unicode `cmap` and
 * leaves every glyph outline and metric untouched, so the result draws the
 * user's exact letterforms.
 *
 * Pure byte manipulation with no DOM, so it runs in the browser at upload
 * time and in Node tests alike.
 */

interface Table {
  tag: string;
  data: Uint8Array;
}

function readTables(font: Uint8Array): { version: number; tables: Table[] } | null {
  if (font.length < 12) return null;
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const version = view.getUint32(0);
  // 0x00010000 = TrueType outlines, 'OTTO' = CFF outlines. Anything else
  // (collections, WOFF, Type 1) is not something pdf.js hands back.
  if (version !== 0x00010000 && version !== 0x4f54544f) return null;
  const numTables = view.getUint16(4);
  if (12 + numTables * 16 > font.length) return null;

  const tables: Table[] = [];
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(font[rec], font[rec + 1], font[rec + 2], font[rec + 3]);
    const offset = view.getUint32(rec + 8);
    const length = view.getUint32(rec + 12);
    if (offset + length > font.length) return null;
    tables.push({ tag, data: font.subarray(offset, offset + length) });
  }
  return { version, tables };
}

/** Every code -> glyph mapping from the cmap subtables we understand. */
function readCmap(cmap: Uint8Array): Map<number, number> {
  const view = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
  const out = new Map<number, number>();
  const count = view.getUint16(2);

  for (let i = 0; i < count; i++) {
    const offset = view.getUint32(4 + i * 8 + 4);
    if (offset + 2 > cmap.length) continue;
    const format = view.getUint16(offset);

    if (format === 0) {
      for (let c = 0; c < 256; c++) {
        const g = cmap[offset + 6 + c];
        if (g && !out.has(c)) out.set(c, g);
      }
    } else if (format === 4) {
      const segX2 = view.getUint16(offset + 6);
      const segs = segX2 / 2;
      const ends = offset + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segs; s++) {
        const end = view.getUint16(ends + s * 2);
        const start = view.getUint16(starts + s * 2);
        const delta = view.getInt16(deltas + s * 2);
        const rangeOffset = view.getUint16(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g: number;
          if (rangeOffset === 0) {
            g = (c + delta) & 0xffff;
          } else {
            const addr = ranges + s * 2 + rangeOffset + (c - start) * 2;
            if (addr + 2 > cmap.length) continue;
            g = view.getUint16(addr);
            if (g) g = (g + delta) & 0xffff;
          }
          if (g && !out.has(c)) out.set(c, g);
        }
      }
    } else if (format === 6) {
      const first = view.getUint16(offset + 6);
      const n = view.getUint16(offset + 8);
      for (let k = 0; k < n; k++) {
        const g = view.getUint16(offset + 10 + k * 2);
        if (g && !out.has(first + k)) out.set(first + k, g);
      }
    } else if (format === 12) {
      const groups = view.getUint32(offset + 12);
      for (let k = 0; k < groups; k++) {
        const rec = offset + 16 + k * 12;
        const start = view.getUint32(rec);
        const end = view.getUint32(rec + 4);
        const glyph = view.getUint32(rec + 8);
        for (let c = start; c <= end && c - start < 0x10000; c++) {
          if (!out.has(c)) out.set(c, glyph + (c - start));
        }
      }
    }
  }
  return out;
}

/** Consecutive codes that map to consecutive glyphs share one segment. */
function runsOf(entries: [number, number][]) {
  const runs: { start: number; end: number; glyph: number }[] = [];
  for (const [code, glyph] of entries) {
    const last = runs[runs.length - 1];
    if (last && code === last.end + 1 && glyph === last.glyph + (code - last.start)) last.end = code;
    else runs.push({ start: code, end: code, glyph });
  }
  return runs;
}

function buildCmap(map: Map<number, number>): Uint8Array {
  const entries = Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  const bmp = runsOf(entries.filter(([c]) => c < 0xffff));
  const all = runsOf(entries);

  // Format 4 (BMP), the table every renderer reads.
  const segs = bmp.length + 1; // plus the mandatory 0xFFFF terminator
  const f4Len = 16 + segs * 8;
  const f4 = new DataView(new ArrayBuffer(f4Len));
  const log = Math.floor(Math.log2(segs));
  f4.setUint16(0, 4);
  f4.setUint16(2, f4Len);
  f4.setUint16(6, segs * 2);
  f4.setUint16(8, 2 * 2 ** log);
  f4.setUint16(10, log);
  f4.setUint16(12, segs * 2 - 2 * 2 ** log);
  const ends = 14;
  const starts = ends + segs * 2 + 2;
  const deltas = starts + segs * 2;
  bmp.forEach((r, s) => {
    f4.setUint16(ends + s * 2, r.end);
    f4.setUint16(starts + s * 2, r.start);
    f4.setUint16(deltas + s * 2, (r.glyph - r.start) & 0xffff);
    // idRangeOffset stays 0: every segment is a plain delta.
  });
  f4.setUint16(ends + bmp.length * 2, 0xffff);
  f4.setUint16(starts + bmp.length * 2, 0xffff);
  f4.setUint16(deltas + bmp.length * 2, 1);

  // Format 12 alongside it, for anything outside the BMP.
  const f12Len = 16 + all.length * 12;
  const f12 = new DataView(new ArrayBuffer(f12Len));
  f12.setUint16(0, 12);
  f12.setUint32(4, f12Len);
  f12.setUint32(12, all.length);
  all.forEach((r, k) => {
    f12.setUint32(16 + k * 12, r.start);
    f12.setUint32(20 + k * 12, r.end);
    f12.setUint32(24 + k * 12, r.glyph);
  });

  const header = 4 + 2 * 8;
  const out = new Uint8Array(header + f4Len + f12Len);
  const view = new DataView(out.buffer);
  view.setUint16(2, 2);
  view.setUint16(4, 3); // Windows
  view.setUint16(6, 1); // Unicode BMP
  view.setUint32(8, header);
  view.setUint16(12, 3);
  view.setUint16(14, 10); // Unicode full repertoire
  view.setUint32(16, header + f4Len);
  out.set(new Uint8Array(f4.buffer), header);
  out.set(new Uint8Array(f12.buffer), header + f4Len);
  return out;
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const word =
      ((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

function writeFont(version: number, tables: Table[]): Uint8Array {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const n = sorted.length;
  const log = Math.floor(Math.log2(n));
  let offset = 12 + n * 16;
  const placed = sorted.map((t) => {
    const at = offset;
    offset += (t.data.length + 3) & ~3;
    return { ...t, at };
  });

  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  view.setUint32(0, version);
  view.setUint16(4, n);
  view.setUint16(6, 16 * 2 ** log);
  view.setUint16(8, log);
  view.setUint16(10, n * 16 - 16 * 2 ** log);

  let headAt = -1;
  placed.forEach((t, i) => {
    const data = t.tag === 'head' ? t.data.slice() : t.data;
    if (t.tag === 'head' && data.length >= 12) {
      new DataView(data.buffer, data.byteOffset).setUint32(8, 0); // zeroed while summing
      headAt = t.at;
    }
    out.set(data, t.at);
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[rec + k] = t.tag.charCodeAt(k);
    view.setUint32(rec + 4, checksum(data));
    view.setUint32(rec + 8, t.at);
    view.setUint32(rec + 12, t.data.length);
  });
  if (headAt >= 0) view.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

export type RemapResult =
  | { ok: true; font: Uint8Array; mapped: number }
  | { ok: false; reason: string };

/**
 * @param unicodeToCode Unicode code point -> the code the font's current cmap
 *   is keyed by (pdf.js's `toFontChar` of the PDF character code).
 */
export function remapFontToUnicode(font: Uint8Array, unicodeToCode: Map<number, number>): RemapResult {
  const parsed = readTables(font);
  if (!parsed) return { ok: false, reason: 'not an OpenType/TrueType file' };

  // Respect the font's embedding licence: "restricted" fonts may be embedded
  // for viewing only, not reused.
  const os2 = parsed.tables.find((t) => t.tag === 'OS/2');
  if (os2 && os2.data.length >= 10) {
    const fsType = new DataView(os2.data.buffer, os2.data.byteOffset).getUint16(8) & 0x000f;
    if (fsType === 0x0002) return { ok: false, reason: 'restricted embedding licence' };
  }

  const cmap = parsed.tables.find((t) => t.tag === 'cmap');
  if (!cmap) return { ok: false, reason: 'no character map' };
  const codeToGlyph = readCmap(cmap.data);

  const unicodeToGlyph = new Map<number, number>();
  for (const [unicode, code] of unicodeToCode) {
    const glyph = codeToGlyph.get(code);
    if (glyph) unicodeToGlyph.set(unicode, glyph);
  }
  if (unicodeToGlyph.size === 0) return { ok: false, reason: 'no characters could be mapped' };

  const tables = parsed.tables.map((t) => (t.tag === 'cmap' ? { tag: 'cmap', data: buildCmap(unicodeToGlyph) } : t));
  return { ok: true, font: writeFont(parsed.version, tables), mapped: unicodeToGlyph.size };
}

/** Code points a remapped font can draw; used to check it covers its own text. */
export function unicodeCoverage(font: Uint8Array): Set<number> {
  const parsed = readTables(font);
  const cmap = parsed?.tables.find((t) => t.tag === 'cmap');
  return new Set(cmap ? readCmap(cmap.data).keys() : []);
}
