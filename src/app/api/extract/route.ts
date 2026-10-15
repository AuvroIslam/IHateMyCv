import { generateStructured } from '@/lib/ai';
import { handleRouteError, jsonError } from '@/lib/api';
import { buildBaseDocument, normalizeExtraction } from '@/lib/assemble';
import { EXTRACTION_SYSTEM, extractionUserPrompt } from '@/lib/prompts';
import { extractionSchema } from '@/lib/schemas';
import { assignFaces } from '@/lib/embedded-fonts';
import { newId } from '@/lib/id';
import { mutateStore, savePageImages, saveSourceFonts, saveSourceLayout } from '@/lib/store';
import type { SourceLayout, UploadedFont } from '@/types/cv';

export const maxDuration = 300;

interface ExtractBody {
  fileName?: string;
  pageCount?: number;
  textDump?: string;
  rawText?: string;
  images?: { mediaType: string; data: string }[];
  fonts?: UploadedFont[];
  layout?: SourceLayout | null;
  /** The original PDF, base64. Kept so alignment can be re-checked later. */
  pdf?: string;
}

const MAX_PDF_B64 = 20_000_000;

const MAX_FONTS = 24;
/** A subset font is tens of KB; this only stops something absurd. */
const MAX_FONT_B64 = 4_000_000;

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

    // The PDF's own fonts. Client ids are replaced so nothing from the request
    // ever becomes a file name.
    const fonts: UploadedFont[] = (body.fonts ?? [])
      .filter((f) => typeof f.data === 'string' && f.data.length < MAX_FONT_B64 && Array.isArray(f.usage))
      .slice(0, MAX_FONTS)
      .map((f) => ({
        ...f,
        id: newId(),
        name: String(f.name ?? '').slice(0, 80),
        format: f.format === 'ttf' ? 'ttf' : 'otf',
        bold: Boolean(f.bold),
        italic: Boolean(f.italic),
      }));
    await saveSourceFonts(fonts);
    await saveSourceLayout(
      body.layout ?? null,
      typeof body.pdf === 'string' && body.pdf.length < MAX_PDF_B64 ? body.pdf : undefined,
    );
    design.font.embedded = assignFaces(fonts, design);
    design.font.useEmbedded = design.font.embedded.length > 0;

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
