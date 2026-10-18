import { handleRouteError, jsonError } from '@/lib/api';
import { buildBaseDocument } from '@/lib/assemble';
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

/**
 * Creates a CV: an untailored copy of the original, or with `copyOf`, a
 * duplicate of one of the owner's CVs (its content, look and job, not its chat).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { copyOf?: string };
    const store = await readStore();
    if (!store.library || !store.design) return jsonError('Upload a CV first.', 409);

    const now = new Date().toISOString();
    const source = body.copyOf ? store.cvs.find((c) => c.id === body.copyOf) : null;
    if (body.copyOf && !source) return jsonError('CV not found.', 404);
    const cv: SavedCv = source
      ? {
          ...structuredClone(source),
          id: newId(),
          name: `Copy of ${source.name}`,
          createdAt: now,
          updatedAt: now,
          chat: [],
        }
      : {
          id: newId(),
          name: 'Copy of your original',
          jobDescription: '',
          createdAt: now,
          updatedAt: now,
          data: buildBaseDocument(store.library, store.design),
          report: null,
        };

    await mutateStore((s) => {
      s.cvs.unshift(cv);
    });

    return Response.json({ cv });
  } catch (err) {
    return handleRouteError(err);
  }
}
