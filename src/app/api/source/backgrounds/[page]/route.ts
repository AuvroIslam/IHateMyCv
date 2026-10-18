import { handleRouteError, jsonError } from '@/lib/api';
import { readPageBackground } from '@/lib/store';

/** Serves a page of the original with its text erased: the exact replica's backdrop. */
export async function GET(_request: Request, context: RouteContext<'/api/source/backgrounds/[page]'>) {
  try {
    const { page } = await context.params;
    const image = await readPageBackground(Number(page));
    if (!image) return jsonError('No background was kept for that page.', 404);
    return new Response(new Uint8Array(image), {
      headers: { 'content-type': 'image/png', 'cache-control': 'private, no-cache' },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
