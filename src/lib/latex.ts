import { strFromU8, unzipSync } from 'fflate';

/**
 * LaTeX CVs: a .tex file, or a whole project as a .zip (Overleaf's "Download
 * source"), is compiled to a PDF by LaTeX-On-HTTP, and the PDF then goes
 * through the normal upload so it becomes an exact copy like any other.
 * LATEX_COMPILE_URL points at another LaTeX-On-HTTP server (self-hosted).
 */

const COMPILE_URL = process.env.LATEX_COMPILE_URL?.trim() || 'https://latex.ytotech.com/builds/sync';
export const LATEX_MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 300;

/** A problem with the user's file, worth showing them as it is. */
export class LatexError extends Error {}

type Compiler = 'pdflatex' | 'xelatex' | 'lualatex';
interface Resource {
  path?: string;
  main?: boolean;
  content?: string;
  file?: string;
}

const TEXT = /\.(tex|cls|sty|bib|bst|cfg|def|clo|ltx|dtx|fd|txt|bbx|cbx|lbx)$/i;
const isMain = (src: string) => /\\documentclass/.test(src) && /\\begin\s*\{document\}/.test(src);

/** Which engine the source wants: a "% !TEX program" line wins, then what it loads. */
function compilerFor(sources: string[]): { compiler: Compiler; explicit: boolean } {
  for (const s of sources) {
    const m = s.match(/^%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*(\w+)/im);
    if (m && /^(pdflatex|xelatex|lualatex)$/i.test(m[1])) return { compiler: m[1].toLowerCase() as Compiler, explicit: true };
  }
  const all = sources.join('\n');
  if (/\\directlua|\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\bluacode\b/.test(all)) return { compiler: 'lualatex', explicit: false };
  if (/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\b(fontspec|polyglossia|xeCJK|unicode-math)\b|\\set(main|sans|mono)font\b/.test(all)) {
    return { compiler: 'xelatex', explicit: false };
  }
  return { compiler: 'pdflatex', explicit: false };
}

/**
 * The files to send: one .tex, or every file of a zipped project with the main
 * .tex marked. A main file in a subfolder can expect paths from the project's
 * top folder (as Overleaf compiles) or from its own folder, so both layouts
 * are offered, top folder first.
 */
function project(fileName: string, bytes: Uint8Array): { layouts: Resource[][]; sources: string[] } {
  if (/\.tex$/i.test(fileName)) {
    const content = strFromU8(bytes);
    if (!isMain(content)) {
      throw new LatexError('That .tex file has no \\documentclass and \\begin{document}. Upload the main file, or the whole project as a .zip.');
    }
    return { layouts: [[{ main: true, content }]], sources: [content] };
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new LatexError('That .zip could not be opened. Download the project again and upload it as it is.');
  }
  const files = Object.entries(entries).filter(([p, data]) => !p.endsWith('/') && !/(^|\/)(__MACOSX|\.)/.test(p) && data.length > 0);
  if (!files.length) throw new LatexError('That .zip is empty.');
  if (files.length > MAX_FILES) throw new LatexError(`That project has more than ${MAX_FILES} files. Upload just the CV's folder.`);
  // A project zipped inside a folder: paths are relative to it.
  const first = files[0][0].split('/')[0];
  const prefix = files.every(([p]) => p.startsWith(`${first}/`)) ? `${first}/` : '';
  const sources: string[] = [];
  const mains: { path: string; content: string }[] = [];
  const resources: (Resource & { path: string })[] = files.map(([p, data]) => {
    const path = p.slice(prefix.length);
    if (!TEXT.test(path)) return { path, file: Buffer.from(data).toString('base64') };
    const content = strFromU8(data);
    sources.push(content);
    if (/\.tex$/i.test(path) && isMain(content)) mains.push({ path, content });
    return { path, content };
  });
  if (!mains.length) {
    throw new LatexError('No main .tex file (one with \\documentclass and \\begin{document}) was found in that .zip.');
  }
  // Prefer the usual names, then the shallowest file.
  const rank = (p: string) => (/(^|\/)(main|resume|cv)\.tex$/i.test(p) ? 0 : 1) * 100 + p.split('/').length;
  const main = mains.sort((a, b) => rank(a.path) - rank(b.path))[0];
  const others = resources.filter((r) => r.path !== main.path);
  const fromTop: Resource[] = [...others, { main: true, content: main.content }];
  const folder = main.path.includes('/') ? main.path.slice(0, main.path.lastIndexOf('/') + 1) : '';
  if (!folder) return { layouts: [fromTop], sources };
  const fromFolder: Resource[] = [
    ...others.filter((r) => r.path.startsWith(folder)).map((r) => ({ ...r, path: r.path.slice(folder.length) })),
    ...others.filter((r) => !r.path.startsWith(folder) && /\.(cls|sty)$/i.test(r.path)).map((r) => ({ ...r, path: r.path.split('/').pop() })),
    { main: true, content: main.content },
  ];
  return { layouts: [fromTop, fromFolder], sources };
}

/** The first LaTeX error in a failed build's logs, in a line people can act on. */
function firstError(payload: unknown): string | null {
  const text = JSON.stringify(payload ?? '');
  const logs = text.replace(/\\n/g, '\n');
  const m = logs.match(/^! (.+)$(?:\n(l\.\d+.*))?/m);
  if (!m) return null;
  return `${m[1].trim()}${m[2] ? ` (${m[2].trim()})` : ''}`.slice(0, 300);
}

async function build(resources: Resource[], compiler: Compiler): Promise<{ pdf?: Uint8Array; error?: string }> {
  let res: Response;
  try {
    res = await fetch(COMPILE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ compiler, resources }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new LatexError('The LaTeX compiler did not respond. Try again in a minute, or upload the PDF instead.');
  }
  const type = res.headers.get('content-type') ?? '';
  if (res.ok && type.includes('pdf')) return { pdf: new Uint8Array(await res.arrayBuffer()) };
  const payload = type.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '');
  return { error: firstError(payload) ?? `the compiler answered ${res.status}` };
}

/** Compiles an uploaded .tex or .zip to a PDF. */
export async function compileLatex(fileName: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length > LATEX_MAX_BYTES) throw new LatexError('That file is too large. Keep LaTeX uploads under 8 MB.');
  const { layouts, sources } = project(fileName, bytes);
  const { compiler, explicit } = compilerFor(sources);
  // Templates that need XeLaTeX do not always say so: it is tried once after pdfLaTeX.
  const engines: Compiler[] = !explicit && compiler === 'pdflatex' ? ['pdflatex', 'xelatex'] : [compiler];
  let firstFailure: string | undefined;
  for (const resources of layouts) {
    for (const engine of engines) {
      const out = await build(resources, engine);
      if (out.pdf) return out.pdf;
      firstFailure ??= out.error;
      // A missing file means the other layout, not the other engine.
      if (out.error && /not found/i.test(out.error)) break;
    }
  }
  throw new LatexError(
    `Your LaTeX did not compile: ${firstFailure}. Check it compiles in Overleaf, or upload the PDF instead. If it uses its own class or images, upload the whole project as a .zip.`,
  );
}
