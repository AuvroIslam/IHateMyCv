import { handleRouteError, jsonError } from '@/lib/api';
import { applyTailorPlan, buildBaseDocument, normalizeExtraction } from '@/lib/assemble';
import { newId } from '@/lib/id';
import { extractionSchema, tailorSchema } from '@/lib/schemas';
import { mutateStore, savePageImages } from '@/lib/store';
import type { SavedCv } from '@/types/cv';
import { DEMO_EXTRACTION, demoTailorPlan } from './fixture';

/**
 * Loads a worked example straight through the real normalisation and assembly
 * code, so the UI can be exercised without an API key. Development only.
 */
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return jsonError('Not available in production.', 404);
  }

  try {
    // Validating the fixture against the live schema means this route fails
    // loudly if the schema and the assembly code ever drift apart.
    const extraction = extractionSchema.parse(DEMO_EXTRACTION);
    const { design, library } = normalizeExtraction(extraction);

    const plan = tailorSchema.parse(demoTailorPlan(library, design));
    const { data, report } = applyTailorPlan(library, design, plan);

    const now = new Date().toISOString();
    const cv: SavedCv = {
      id: newId(),
      name: 'Backend Engineer at Northwind',
      jobTitle: report.roleTitle,
      company: report.company,
      jobDescription: 'Demo job description (seeded).',
      createdAt: now,
      updatedAt: now,
      data,
      report,
    };

    // The fixture has no rendered pages, so clear any left from a real upload
    // rather than comparing the demo against someone else's CV.
    await savePageImages([]);

    await mutateStore((store) => {
      store.design = design;
      store.library = library;
      store.original = buildBaseDocument(library, design);
      store.source = {
        fileName: 'demo-cv.pdf',
        uploadedAt: now,
        pageCount: 1,
        textPreview: 'Seeded demo data.',
      };
      store.cvs = [cv];
    });

    return Response.json({
      ok: true,
      cvId: cv.id,
      sections: design.sections.length,
      entries: library.entries.length,
      skills: library.skillGroups.reduce((n, g) => n + g.skills.length, 0),
      includedInTailoredCv: report.included.length,
      excludedFromTailoredCv: report.excluded.length,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
