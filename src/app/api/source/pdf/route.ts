import { handleRouteError, jsonError } from '@/lib/api';
import { readSourcePdf } from '@/lib/store';

/** The originally uploaded PDF, as kept at upload time. */
export async function GET() {
  try {
    const data = await readSourcePdf();
    if (!data) return jsonError('No original PDF was kept.', 404);
    return new Response(new Uint8Array(data), {
      headers: { 'content-type': 'application/pdf', 'cache-control': 'private, no-cache' },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
