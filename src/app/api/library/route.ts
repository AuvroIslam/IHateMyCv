import { handleRouteError, jsonError } from '@/lib/api';
import { getAppState } from '@/lib/state';
import { mutateStore, resetStore } from '@/lib/store';
import type { CareerLibrary, DesignSpec } from '@/types/cv';

export async function GET() {
  try {
    return Response.json(await getAppState());
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      library?: CareerLibrary;
      design?: DesignSpec;
    };
    if (!body.library && !body.design) return jsonError('Nothing to update.');

    const { store } = await mutateStore((s) => {
      if (body.library) s.library = body.library;
      if (body.design) s.design = body.design;
    });

    return Response.json({ library: store.library, design: store.design });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE() {
  try {
    await resetStore();
    return Response.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
