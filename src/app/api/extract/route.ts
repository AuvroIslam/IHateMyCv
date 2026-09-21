import { generateStructured } from '@/lib/ai';
import { handleRouteError, jsonError } from '@/lib/api';
import { buildBaseDocument, normalizeExtraction } from '@/lib/assemble';
import { EXTRACTION_SYSTEM, extractionUserPrompt } from '@/lib/prompts';
import { extractionSchema } from '@/lib/schemas';
import { mutateStore, savePageImages } from '@/lib/store';

export const maxDuration = 300;

interface ExtractBody {
  fileName?: string;
  pageCount?: number;
  textDump?: string;
  rawText?: string;
  images?: { mediaType: string; data: string }[];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExtractBody;
    const textDump = body.textDump?.trim();
    if (!textDump) return jsonError('No text could be read from that file.');

    const pageCount = Math.max(1, Math.round(body.pageCount ?? 1));
    const images = (body.images ?? []).slice(0, 3);

    const parsed = await generateStructured({
      system: EXTRACTION_SYSTEM,
      user: extractionUserPrompt(textDump, pageCount),
      images,
      schema: extractionSchema,
      name: 'cv_extraction',
      // Runs once per CV, and every generated CV inherits its measurements.
      effort: 'high',
    });

    const { design, library } = normalizeExtraction(parsed);
    const pageImages = await savePageImages(images);

    await mutateStore((store) => {
      store.design = design;
      store.library = library;
      // At this moment the library is exactly the original CV, so this is the
      // reference every later design check is compared against.
      store.original = buildBaseDocument(library, design);
      store.source = {
        fileName: body.fileName ?? 'cv.pdf',
        uploadedAt: new Date().toISOString(),
        pageCount,
        textPreview: (body.rawText ?? '').slice(0, 4000),
        pageImages,
      };
      // The library was rebuilt from a new source document, so previously
      // generated CVs reference entry ids that no longer exist.
      store.cvs = [];
    });

    return Response.json({
      design,
      library,
      stats: {
        sections: design.sections.length,
        entries: library.entries.length,
        bullets: library.entries.reduce((n, e) => n + e.bullets.length, 0),
        skills: library.skillGroups.reduce((n, g) => n + g.skills.length, 0),
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
