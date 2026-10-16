import { after } from 'next/server';
import { generateStructured } from '@/lib/ai';
import { handleRouteError, jsonError } from '@/lib/api';
import { buildBaseDocument, normalizeExtraction } from '@/lib/assemble';
import { applyContentFacts, applyMeasuredFacts } from '@/lib/design-facts';
import { assignFaces } from '@/lib/embedded-fonts';
import { newId } from '@/lib/id';
import { attachSourceLines } from '@/lib/line-lock';
import {
  CONTENT_SYSTEM,
  DESIGN_SYSTEM,
  TAGS_SYSTEM,
  contentUserPrompt,
  designUserPrompt,
  tagsUserPrompt,
} from '@/lib/prompts';
import { contentSchema, designBodySchema, designPageSchema, tagsSchema, type ExtractionResult } from '@/lib/schemas';
import { mutateStore, readStore, savePageImages, saveSourceFonts, saveSourceLayout } from '@/lib/store';
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

/**
 * Reads an uploaded CV in about half a minute.
 *
 * One call used to do everything at high effort and took four to five
 * minutes, nearly all of it the model deliberating over spacing numbers.
 * Spacing is now measured exactly by auto-align, so the work splits:
 * - design (images + coordinates): which layouts and styles, at low effort;
 * - content (coordinates only): the words and their structure;
 * run in parallel, then facts the PDF states outright are applied over the
 * design. Matching keywords, which only tailoring reads, are written after
 * the response has gone.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExtractBody;
    const textDump = body.textDump?.trim();
    if (!textDump) return jsonError('No text could be read from that file.');

    const pageCount = Math.max(1, Math.round(body.pageCount ?? 1));
    const images = (body.images ?? []).slice(0, 3);
    const layout = body.layout ?? null;

    // The design is read in two halves (see designPageSchema), side by side.
    const look = { system: DESIGN_SYSTEM, user: designUserPrompt(textDump, pageCount), images, name: 'cv_design', effort: 'low' } as const;
    const [pageLook, bodyLook, rawContent] = await Promise.all([
      generateStructured({ ...look, schema: designPageSchema }),
      generateStructured({ ...look, schema: designBodySchema }),
      generateStructured({
        system: CONTENT_SYSTEM,
        user: contentUserPrompt(textDump, pageCount),
        schema: contentSchema,
        name: 'cv_content',
        effort: 'low',
      }),
    ]);

    const content = applyContentFacts(rawContent, layout);
    const merged: ExtractionResult = {
      design: applyMeasuredFacts({ ...pageLook.design, ...bodyLook.design, sections: content.sections }, content, layout),
      personal: content.personal,
      summary: content.summary,
      entries: content.entries.map((e) => ({
        ...e,
        bullets: e.bullets.map((text) => ({ text, tags: [] })),
        tags: [],
      })),
      skillGroups: content.skillGroups,
      pageCount: content.pageCount,
    };

    const normalized = normalizeExtraction(merged);
    const design = normalized.design;
    // While the library still matches the PDF word for word, remember how the
    // original broke each paragraph's lines.
    const library = attachSourceLines(normalized.library, layout);
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
      layout,
      typeof body.pdf === 'string' && body.pdf.length < MAX_PDF_B64 ? body.pdf : undefined,
    );
    design.font.embedded = assignFaces(fonts, design);
    design.font.useEmbedded = design.font.embedded.length > 0;

    const uploadedAt = new Date().toISOString();
    await mutateStore((store) => {
      store.design = design;
      store.library = library;
      // At this moment the library is exactly the original CV, so this is the
      // reference every later design check is compared against.
      store.original = buildBaseDocument(library, design);
      store.source = {
        fileName: body.fileName ?? 'cv.pdf',
        uploadedAt,
        pageCount,
        textPreview: (body.rawText ?? '').slice(0, 4000),
        pageImages,
      };
      // The library was rebuilt from a new source document, so previously
      // generated CVs reference entry ids that no longer exist.
      store.cvs = [];
    });

    after(() => tagLibrary(uploadedAt));

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

/**
 * Writes matching keywords onto the library just built. Never blocks the
 * upload: until it lands, tailoring simply works from the text alone.
 */
async function tagLibrary(uploadedAt: string) {
  try {
    const store = await readStore();
    const entries = store.library?.entries ?? [];
    if (!entries.length) return;

    const result = await generateStructured({
      system: TAGS_SYSTEM,
      user: tagsUserPrompt(entries.map((e) => ({ title: e.title, subtitle: e.subtitle, bullets: e.bullets.map((b) => b.text) }))),
      schema: tagsSchema,
      name: 'cv_tags',
      tier: 'fast',
      effort: 'low',
    });

    const clean = (tags: string[]) =>
      Array.from(new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))).slice(0, 14);

    await mutateStore((s) => {
      // A newer upload replaced this library while we worked: drop the result.
      if (!s.library || s.source?.uploadedAt !== uploadedAt) return;
      for (const t of result.entries) {
        const entry = s.library.entries[t.index];
        if (!entry || entry.tags.length) continue; // never overwrite the user's own tags
        entry.tags = clean(t.tags);
        entry.bullets.forEach((b, k) => {
          if (!b.tags.length && t.bulletTags[k]) b.tags = clean(t.bulletTags[k]);
        });
      }
    });
  } catch (err) {
    // Keywords are an optimisation; a failure here must not surface as an error.
    console.error('Background tagging failed:', err);
  }
}
