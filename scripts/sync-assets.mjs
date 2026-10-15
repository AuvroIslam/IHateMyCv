// Copies runtime assets out of node_modules into /public so they are served as
// static files, locked to the installed package versions:
//
// - the pdf.js worker, which pdf.js loads by URL;
// - Computer Modern (CMU), the LaTeX default face. Google Fonts has no
//   metric-compatible stand-in, and LaTeX CVs are common enough to matter.
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
const pub = path.join(process.cwd(), 'public');
const rel = (p) => path.relative(process.cwd(), p);

// pdf.js worker
const workerDest = path.join(pub, 'pdf.worker.min.mjs');
await mkdir(pub, { recursive: true });
await copyFile(path.join(pkgDir('pdfjs-dist'), 'build', 'pdf.worker.min.mjs'), workerDest);
console.log(`pdf.js worker -> ${rel(workerDest)}`);

// Computer Modern. The package ships a 500 "regular" and a 700 bold; declaring
// weight ranges maps CSS 400 and 600 onto the right file.
const faces = [
  { family: 'CMU Serif', file: 'cmu-serif' },
  { family: 'CMU Sans Serif', file: 'cmu-sans-serif' },
];
const cuts = [
  { weight: '100 599', w: 500, style: 'normal', s: 'roman' },
  { weight: '100 599', w: 500, style: 'italic', s: 'italic' },
  { weight: '600 900', w: 700, style: 'normal', s: 'roman' },
  { weight: '600 900', w: 700, style: 'italic', s: 'italic' },
];

const fontDir = path.join(pub, 'fonts', 'cmu');
await mkdir(fontDir, { recursive: true });
const srcDir = path.join(pkgDir('computer-modern'), 'fonts');
const css = [];
for (const face of faces) {
  for (const cut of cuts) {
    const name = `${face.file}-${cut.w}-${cut.s}.woff2`;
    await copyFile(path.join(srcDir, name), path.join(fontDir, name));
    css.push(
      `@font-face {\n  font-family: "${face.family}";\n  font-style: ${cut.style};\n  font-weight: ${cut.weight};\n  font-display: block;\n  src: url("./${name}") format("woff2");\n}`,
    );
  }
}
await writeFile(path.join(fontDir, 'cmu.css'), `${css.join('\n\n')}\n`);
console.log(`Computer Modern -> ${rel(fontDir)}`);
