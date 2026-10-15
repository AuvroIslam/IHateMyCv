import { handleRouteError, jsonError } from '@/lib/api';
import { readSourceFont } from '@/lib/store';

/** Serves a font extracted from the uploaded CV. */
export async function GET(_request: Request, context: RouteContext<'/api/source/fonts/[id]'>) {
  try {
    const { id } = await context.params;
    const font = await readSourceFont(id);
    if (!font) return jsonError('No such font.', 404);
    return new Response(new Uint8Array(font.data), {
      headers: {
        'content-type': font.format === 'otf' ? 'font/otf' : 'font/ttf',
        // Ids are fresh on every upload, so a given URL never changes content.
        'cache-control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
