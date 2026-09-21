// pdf.js needs its worker served as a static asset. Copying it into /public at
// install/dev time keeps the worker version locked to the installed pdfjs-dist
// without relying on bundler-specific URL handling.
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const src = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'build', 'pdf.worker.min.mjs');
const dest = path.join(process.cwd(), 'public', 'pdf.worker.min.mjs');

await mkdir(path.dirname(dest), { recursive: true });
await copyFile(src, dest);
console.log(`pdf.js worker -> ${path.relative(process.cwd(), dest)}`);
