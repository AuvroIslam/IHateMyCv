import { handleRouteError, jsonError } from '@/lib/api';
import { readPageImage } from '@/lib/store';

/** Serves a render of the originally uploaded CV, for design comparison. */
export async function GET(request: Request, context: RouteContext<'/api/source/pages/[page]'>) {
  try {
    const { page } = await context.params;
    const template = new URL(request.url).searchParams.get('template') || undefined;
    const image = await readPageImage(Number(page), template);
    if (!image) return jsonError('No render of that page was kept.', 404);
    return new Response(new Uint8Array(image), {
      headers: {
        'content-type': 'image/jpeg',
        // A re-upload replaces the file under the same URL; the client adds a
        // version query, so this only needs to stop stale intermediary caches.
        'cache-control': 'private, no-cache',
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
