'use client';

/**
 * Browser-side CV parsing.
 *
 * This deliberately runs in the browser rather than on the server: pdf.js can
 * rasterise pages using the browser's own canvas, so we get page images for the
 * vision pass without pulling in a native canvas binding. The server then only
 * has to deal with text and base64.
 */

export interface ParsedUpload {
  kind: 'pdf' | 'docx' | 'txt';
  fileName: string;
  pageCount: number;
  /** Positioned text runs, one per line, for measuring the design. */
  textDump: string;
  rawText: string;
  /** Base64 page renders (no data: prefix) for the vision pass. */
  images: { mediaType: string; data: string }[];
}

const MAX_VISION_PAGES = 3;
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

interface Run {
  x: number;
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
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

  const dumpParts: string[] = [];
  const rawParts: string[] = [];
  const images: ParsedUpload['images'] = [];

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const runs: Run[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const t = item.transform as number[];
      const size = Math.hypot(t[2], t[3]) || item.height || 0;
      const fontName = resolveFontName(page, item.fontName);
      runs.push({
        x: round(t[4]),
        y: round(viewport.height - t[5]),
        size: round(size),
        font: fontName,
        text: item.str,
        bold: /bold|black|heavy|semib|[-_]b\b|medi/i.test(fontName),
        italic: /italic|oblique|[-_]i\b/i.test(fontName),
      });
    }

    const lines = groupIntoLines(runs);
    rawParts.push(lines.map((l) => l.text).join('\n'));

    dumpParts.push(
      `--- PAGE ${pageNo} (${round(viewport.width)}x${round(viewport.height)}pt) ---`,
    );
    for (const line of lines.slice(0, MAX_DUMP_LINES_PER_PAGE)) {
      const flags = [line.bold ? 'bold' : '', line.italic ? 'italic' : ''].filter(Boolean).join('+');
      dumpParts.push(
        `x=${line.x} y=${line.y} size=${line.size} font=${line.font}${flags ? ` (${flags})` : ''} | ${line.text}`,
      );
    }
    if (lines.length > MAX_DUMP_LINES_PER_PAGE) {
      dumpParts.push(`... ${lines.length - MAX_DUMP_LINES_PER_PAGE} more lines on this page`);
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
  };
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

/** Merge text runs sharing a baseline into readable lines. */
function groupIntoLines(runs: Run[]) {
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: (Run & { endX: number })[] = [];

  for (const run of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - run.y) <= 2.2) {
      const gap = run.x - last.endX;
      // A gap wider than a third of the font size reads as a real space.
      const joiner = gap > run.size * 0.33 ? ' ' : '';
      last.text += joiner + run.text;
      last.endX = run.x + estimateWidth(run);
      last.size = Math.max(last.size, run.size);
      last.bold = last.bold || run.bold;
      last.italic = last.italic || run.italic;
    } else {
      lines.push({ ...run, endX: run.x + estimateWidth(run) });
    }
  }

  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter((l) => l.text);
}

function estimateWidth(run: Run): number {
  return run.text.length * run.size * 0.5;
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

  const rawText = doc.body.textContent?.replace(/\n{3,}/g, '\n\n').trim() ?? '';
  return {
    kind: 'docx',
    fileName: file.name,
    pageCount: Math.max(1, Math.ceil(rawText.length / 3200)),
    textDump: ['--- DOCX STRUCTURE (no coordinates available) ---', ...lines].join('\n'),
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
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
