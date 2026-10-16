import fs from 'node:fs/promises';
import path from 'node:path';
import { handleRouteError, jsonError } from '@/lib/api';
import { DATA_DIR } from '@/lib/store';

/** The originally uploaded PDF, as kept at upload time. */
export async function GET() {
  try {
    const data = await fs.readFile(path.join(DATA_DIR, 'source.pdf'));
    return new Response(new Uint8Array(data), {
      headers: { 'content-type': 'application/pdf', 'cache-control': 'private, no-cache' },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return jsonError('No original PDF was kept.', 404);
    return handleRouteError(err);
  }
}
