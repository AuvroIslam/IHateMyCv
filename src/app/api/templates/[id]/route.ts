import { handleRouteError, jsonError } from '@/lib/api';
import { mutateStore } from '@/lib/store';
import type { DesignSpec } from '@/types/cv';

/** Saves a template's design: after auto-align has fitted it to that CV's measured spacing. */
export async function PUT(request: Request, context: RouteContext<'/api/templates/[id]'>) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { design?: DesignSpec };
    if (!body.design || !Array.isArray(body.design.sections)) return jsonError('That is not a design.');
    const { result } = await mutateStore((store) => {
      const template = (store.templates ?? []).find((t) => t.id === id);
      if (!template) return false;
      // Its files stay where they are: the id is the template's, whatever was sent.
      // Its header's fixed lines are its own, even if the sender saw them left out.
      const next: DesignSpec = { ...body.design!, template: id };
      const literals = template.design.header.template?.literals;
      if (literals?.length && next.header.template) next.header = { ...next.header, template: { ...next.header.template, literals } };
      template.design = next;
      return true;
    });
    if (!result) return jsonError('That CV design no longer exists.', 404);
    return Response.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
