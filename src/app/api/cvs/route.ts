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

/** Creates an untailored copy of the original CV, as a manual starting point. */
export async function POST() {
  try {
    const store = await readStore();
    if (!store.library || !store.design) return jsonError('Upload a CV first.', 409);

    const now = new Date().toISOString();
    const cv: SavedCv = {
      id: newId(),
      name: 'Untitled CV',
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
