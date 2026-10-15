import { handleRouteError, jsonError } from '@/lib/api';
import { readSourceLayout } from '@/lib/store';

/** Where every line sat on the original PDF, for auto-alignment. */
export async function GET() {
  try {
    const layout = await readSourceLayout();
    if (!layout) return jsonError('No layout was captured for this CV. Re-upload the PDF.', 404);
    return Response.json({ layout });
  } catch (err) {
    return handleRouteError(err);
  }
}
