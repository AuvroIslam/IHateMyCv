import { handleRouteError, jsonError } from '@/lib/api';
import { mutateStore, readStore } from '@/lib/store';
import type { ChatTurn, CvDocumentData } from '@/types/cv';

export async function GET(_request: Request, context: RouteContext<'/api/cvs/[id]'>) {
  try {
    const { id } = await context.params;
    const store = await readStore();
    const cv = store.cvs.find((c) => c.id === id);
    if (!cv) return jsonError('CV not found.', 404);
    return Response.json({ cv, design: store.design, library: store.library });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PUT(request: Request, context: RouteContext<'/api/cvs/[id]'>) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { data?: CvDocumentData; name?: string; chat?: ChatTurn[] };

    const { result } = await mutateStore((store) => {
      const cv = store.cvs.find((c) => c.id === id);
      if (!cv) return null;
      if (body.data) cv.data = body.data;
      if (typeof body.name === 'string' && body.name.trim()) cv.name = body.name.trim();
      // The latest 60 messages: plenty to scroll back through, bounded in size.
      if (Array.isArray(body.chat)) cv.chat = body.chat.slice(-60);
      cv.updatedAt = new Date().toISOString();
      return cv;
    });

    if (!result) return jsonError('CV not found.', 404);
    return Response.json({ cv: result });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(_request: Request, context: RouteContext<'/api/cvs/[id]'>) {
  try {
    const { id } = await context.params;
    const { result } = await mutateStore((store) => {
      const before = store.cvs.length;
      store.cvs = store.cvs.filter((c) => c.id !== id);
      return store.cvs.length < before;
    });
    if (!result) return jsonError('CV not found.', 404);
    return Response.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
