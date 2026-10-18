import { handleRouteError, jsonError } from '@/lib/api';
import { newId } from '@/lib/id';
import { mutateStore, readStore } from '@/lib/store';
import type { SavedCv } from '@/types/cv';

export async function GET() {
  try {
    const store = await readStore();
    return Response.json({ cvs: store.cvs });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** Duplicates one of the owner's CVs: its content, look and job, not its chat. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { copyOf?: string };
    const store = await readStore();
    const source = body.copyOf ? store.cvs.find((c) => c.id === body.copyOf) : null;
    if (!source) return jsonError('Choose a CV to duplicate.', body.copyOf ? 404 : 400);

    const now = new Date().toISOString();
    const cv: SavedCv = {
      ...structuredClone(source),
      id: newId(),
      name: `Copy of ${source.name}`,
      createdAt: now,
      updatedAt: now,
      chat: [],
      // A copy is not the upload itself: it neither stands for its design nor asks about My Info.
      uploaded: undefined,
      askedImport: undefined,
    };

    await mutateStore((s) => {
      s.cvs.unshift(cv);
    });

    return Response.json({ cv });
  } catch (err) {
    return handleRouteError(err);
  }
}
