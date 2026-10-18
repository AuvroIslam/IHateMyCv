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
import { mutateStore, readStore, savePageBackgrounds, savePageImages, saveSourceFonts, saveSourceLayout } from '@/lib/store';
import { firstCv } from '@/lib/state';
import { MAX_TEMPLATES } from '@/lib/templates';
import { workspaceId } from '@/lib/workspace';
import type { SavedCv, SourceLayout, UploadedFont } from '@/types/cv';
import { consume } from '@/lib/limits';

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
  /** Each page with its text erased, PNG base64, for the exact replica. */
  backgrounds?: { mediaType: string; data: string }[];
}

/** A text-free page render is a few hundred KB; this only stops something absurd. */
const MAX_BACKGROUND_B64 = 6_000_000;

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
    // Page renders, fonts and the PDF itself arrive inline; real CVs come in
    // well under this.
    if (Number(request.headers.get('content-length')) > 40_000_000) {
      return jsonError('That file is too large to read. Upload a CV under 10 MB.', 413);
    }
    const body = (await request.json()) as ExtractBody;
    const textDump = body.textDump?.trim();
    if (!textDump) return jsonError('No text could be read from that file.');
    // It goes to three model calls: a real CV is far under this.
    if (textDump.length > 150_000) return jsonError('That file has far more text than a CV. Upload a CV of a few pages.', 413);
    // Every upload becomes a CV of its own. The first is stored as the base
    // (store.design / store.library); every later one as a template beside it.
    // Nothing is ever replaced.
    const current = await readStore();
    const templateId = current.library && current.design ? newId() : undefined;
    if (templateId && (current.templates ?? []).filter((t) => !t.hidden).length >= MAX_TEMPLATES) {
      return jsonError(`You can keep up to ${MAX_TEMPLATES + 1} uploaded CVs. Delete one in My CVs first.`, 409);
    }
    await consume('upload');

    const pageCount = Math.max(1, Math.round(body.pageCount ?? 1));
    const images = (body.images ?? []).filter((i) => typeof i?.data === 'string' && i.data.length < 6_000_000).slice(0, 3);
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
    const pageImages = await savePageImages(images, templateId);

    // The PDF's own fonts. Client ids are replaced so nothing from the request
    // ever becomes a file name.
    const fontIds = new Map<string, string>();
    const fonts: UploadedFont[] = (body.fonts ?? [])
      .filter((f) => typeof f.data === 'string' && f.data.length < MAX_FONT_B64 && Array.isArray(f.usage))
      .slice(0, MAX_FONTS)
      .map((f) => ({
        ...f,
        id: fontIds.set(String(f.id), newId()).get(String(f.id))!,
        name: String(f.name ?? '').slice(0, 80),
        format: f.format === 'ttf' ? 'ttf' : 'otf',
        bold: Boolean(f.bold),
        italic: Boolean(f.italic),
      }));
    await saveSourceFonts(fonts, templateId);
    // Runs name their font by the client's id; point them at the stored one.
    for (const page of layout?.pages ?? []) {
      for (const line of page.lines) {
        for (const run of line.runs) {
          const id = run.face ? fontIds.get(run.face) : undefined;
          if (id) run.face = id;
          else delete run.face;
        }
      }
    }
    const backgrounds = await savePageBackgrounds(
      (body.backgrounds ?? []).filter((b) => typeof b.data === 'string' && b.data.length < MAX_BACKGROUND_B64).slice(0, 6),
      templateId,
    );
    await saveSourceLayout(
      layout,
      typeof body.pdf === 'string' && body.pdf.length < MAX_PDF_B64 ? body.pdf : undefined,
      templateId,
    );
    design.font.embedded = assignFaces(fonts, design);
    design.font.useEmbedded = design.font.embedded.length > 0;

    const uploadedAt = new Date().toISOString();
    const source = {
      fileName: body.fileName ?? 'cv.pdf',
      uploadedAt,
      pageCount,
      textPreview: (body.rawText ?? '').slice(0, 4000),
      pageImages,
      backgrounds,
    };
    const stats = {
      sections: design.sections.length,
      entries: library.entries.length,
      bullets: library.entries.reduce((n, e) => n + e.bullets.length, 0),
      skills: library.skillGroups.reduce((n, g) => n + g.skills.length, 0),
    };

    if (templateId) {
      // A new CV in its own design, beside everything else.
      design.template = templateId;
      const original = buildBaseDocument(library, design);
      const cv: SavedCv = {
        id: newId(),
        name: source.fileName.replace(/\.[a-z0-9]+$/i, ''),
        templateId,
        uploaded: true,
        jobDescription: '',
        createdAt: uploadedAt,
        updatedAt: uploadedAt,
        data: original,
        report: null,
      };
      await mutateStore((store) => {
        store.templates = [...(store.templates ?? []), { id: templateId, design, library, original, source }];
        store.cvs.unshift(cv);
      });
      const ws = await workspaceId();
      after(() => tagLibrary(uploadedAt, ws, templateId));
      return Response.json({ design, library, stats, cvId: cv.id });
    }

    const { result: cvId } = await mutateStore((store) => {
      store.design = design;
      store.library = library;
      // At this moment the library is exactly the CV, so this is the
      // reference its exact copy and design checks compare against.
      store.original = buildBaseDocument(library, design);
      store.source = source;
      store.firstHidden = false;
      const cv = firstCv(store);
      store.cvs.unshift(cv);
      return cv.id;
    });

    // Tagging outlives the request, so it takes this workspace along.
    const ws = await workspaceId();
    after(() => tagLibrary(uploadedAt, ws));

    return Response.json({ design, library, stats, cvId });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Writes matching keywords onto the library just built. Never blocks the
 * upload: until it lands, tailoring simply works from the text alone.
 */
async function tagLibrary(uploadedAt: string, ws: string, templateId?: string) {
  try {
    const store = await readStore(ws);
    // The upload's own content: the first one's, or its template's.
    const libraryOf = (s: typeof store) =>
      templateId ? s.templates?.find((t) => t.id === templateId)?.library : s.library;
    const entries = libraryOf(store)?.entries ?? [];
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
      // The upload was deleted while we worked: drop the result.
      const library = libraryOf(s);
      const source = templateId ? s.templates?.find((t) => t.id === templateId)?.source : s.source;
      if (!library || source?.uploadedAt !== uploadedAt) return;
      for (const t of result.entries) {
        const entry = library.entries[t.index];
        if (!entry || entry.tags.length) continue; // never overwrite the user's own tags
        entry.tags = clean(t.tags);
        entry.bullets.forEach((b, k) => {
          if (!b.tags.length && t.bulletTags[k]) b.tags = clean(t.bulletTags[k]);
        });
      }
    }, ws);
  } catch (err) {
    // Keywords are an optimisation; a failure here must not surface as an error.
    console.error('Background tagging failed:', err);
  }
}
