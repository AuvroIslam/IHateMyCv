import { generateStructured } from '@/lib/ai';
import { handleRouteError, jsonError } from '@/lib/api';
import { normalizeImport } from '@/lib/assemble';
import { IMPORT_SYSTEM, importUserPrompt } from '@/lib/prompts';
import { importSchema } from '@/lib/schemas';
import { readStore } from '@/lib/store';
import { consume } from '@/lib/limits';

export const maxDuration = 120;

/**
 * Structures free-form notes into library entries. Nothing is saved here: the
 * result goes into the library editor's draft so the user reviews it first.
 */
export async function POST(request: Request) {
  try {
    const { notes, sectionId } = (await request.json()) as { notes?: string; sectionId?: string };
    const text = notes?.trim();
    if (!text) return jsonError('Write a few notes first.');
    if (text.length > 8000) return jsonError('Those notes are too long. Add one job or project at a time.');

    const store = await readStore();
    if (!store.library || !store.design) {
      return jsonError('Upload a CV first so there is a Career Library to add to.', 409);
    }
    const section = store.design.sections.find((s) => s.id === sectionId);
    if (!section) return jsonError('That section no longer exists.', 404);
    if (section.type === 'summary') {
      return jsonError('Summaries are written directly - there is nothing to structure.');
    }
    await consume('import');

    const parsed = await generateStructured({
      system: IMPORT_SYSTEM,
      user: importUserPrompt(store.library, section, text),
      schema: importSchema,
      name: 'library_import',
      tier: 'fast',
    });

    const result = normalizeImport(parsed, section.id);
    if (result.entries.length === 0 && result.skills.length === 0) {
      return jsonError('Nothing in those notes could be turned into an entry. Add a little more detail.', 422);
    }
    return Response.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
