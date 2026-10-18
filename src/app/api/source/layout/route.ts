import { handleRouteError, jsonError } from '@/lib/api';
import { readSourceLayout } from '@/lib/store';

/** Where every line sat on the original PDF, for auto-alignment. */
export async function GET(request: Request) {
  try {
    const template = new URL(request.url).searchParams.get('template') || undefined;
    const layout = await readSourceLayout(template);
    if (!layout) return jsonError('No layout was captured for this CV. Re-upload the PDF.', 404);
    return Response.json({ layout });
  } catch (err) {
    return handleRouteError(err);
  }
}
