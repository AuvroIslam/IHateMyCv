import { handleRouteError, jsonError } from '@/lib/api';
import { mutateStore, readStore, removeTemplateFiles } from '@/lib/store';
import { contextOf } from '@/lib/templates';
import type { ChatTurn, CvDocumentData } from '@/types/cv';

export async function GET(_request: Request, context: RouteContext<'/api/cvs/[id]'>) {
  try {
    const { id } = await context.params;
    const store = await readStore();
    const cv = store.cvs.find((c) => c.id === id);
    if (!cv) return jsonError('CV not found.', 404);
    // The CV's own design: the original's, or the template it follows.
    const ctx = contextOf(store, cv);
    return Response.json({
      cv,
      design: ctx?.design ?? null,
      library: ctx?.library ?? null,
      template: ctx?.template ? { id: ctx.template.id, source: ctx.template.source, original: ctx.template.original } : null,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PUT(request: Request, context: RouteContext<'/api/cvs/[id]'>) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { data?: CvDocumentData; name?: string; chat?: ChatTurn[]; askedImport?: boolean };

    const { result } = await mutateStore((store) => {
      const cv = store.cvs.find((c) => c.id === id);
      if (!cv) return null;
      if (body.data) cv.data = body.data;
      if (typeof body.name === 'string' && body.name.trim()) cv.name = body.name.trim();
      if (body.askedImport === true) cv.askedImport = true;
      // The latest 60 messages: plenty to scroll back through, bounded in size.
      if (Array.isArray(body.chat)) cv.chat = keepRewindPoints(body.chat.slice(-60));
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
      const cv = store.cvs.find((c) => c.id === id);
      if (!cv) return null;
      store.cvs = store.cvs.filter((c) => c.id !== id);
      // A template no CV follows any more goes with its last CV.
      const orphan = cv.templateId && !store.cvs.some((c) => c.templateId === cv.templateId) ? cv.templateId : null;
      if (orphan) store.templates = (store.templates ?? []).filter((t) => t.id !== orphan);
      return { orphan };
    });
    if (!result) return jsonError('CV not found.', 404);
    if (result.orphan) await removeTemplateFiles(result.orphan);
    return Response.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** Rewind points kept per CV: each is a whole copy of the CV, and the CV must stay a small document. */
const REWIND_POINTS = 12;

/** Drops the CV copies from all but the latest messages. */
function keepRewindPoints(chat: ChatTurn[]): ChatTurn[] {
  let kept = 0;
  return chat
    .slice()
    .reverse()
    .map((t) => {
      if (!t.before) return t;
      if (kept++ < REWIND_POINTS) return t;
      const rest = { ...t };
      delete rest.before;
      return rest;
    })
    .reverse();
}
