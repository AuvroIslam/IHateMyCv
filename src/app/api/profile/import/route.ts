import { generateStructured } from '@/lib/ai';
import { handleRouteError, jsonError } from '@/lib/api';
import { newId } from '@/lib/id';
import { consume } from '@/lib/limits';
import { PROFILE_IMPORT_SYSTEM, profileImportUserPrompt } from '@/lib/prompts';
import { profileImportSchema } from '@/lib/schemas';
import type { Profile } from '@/types/cv';

export const maxDuration = 120;

/**
 * Reads one CV's text (parsed in the browser) into Profile form. Nothing is
 * saved here: the result is compared with My Info and the owner chooses what
 * to keep.
 */
export async function POST(request: Request) {
  try {
    const { textDump, fileName } = (await request.json()) as { textDump?: string; fileName?: string };
    const text = textDump?.trim();
    if (!text || text.length < 80) return jsonError('No readable text in that file. If it is a scan, export a text-based PDF instead.');
    if (text.length > 120_000) return jsonError('That file is too long to read as a CV.');
    await consume('import');

    const read = await generateStructured({
      system: PROFILE_IMPORT_SYSTEM,
      user: profileImportUserPrompt(text, (fileName ?? 'cv').slice(0, 120)),
      schema: profileImportSchema,
      name: 'profile_import',
      effort: 'low',
    });

    const clean = (s: string | null | undefined) => s?.trim() || undefined;
    const profile: Profile = {
      personal: {
        fullName: read.personal.fullName.trim(),
        headline: clean(read.personal.headline),
        email: clean(read.personal.email),
        phone: clean(read.personal.phone),
        location: clean(read.personal.location),
        links: read.personal.links
          .filter((l) => l.label.trim() || l.href || l.value)
          .map((l) => ({ id: newId(), label: l.label.trim(), value: l.value, href: l.href ?? undefined })),
      },
      summary: read.summary?.trim() ?? '',
      about: read.about.map((l) => l.trim()).filter(Boolean).join('\n'),
      entries: read.entries
        .filter((e) => e.title.trim() || e.bullets.length)
        .map((e) => ({
          id: newId(),
          sectionId: e.kind,
          title: e.title.trim(),
          subtitle: clean(e.subtitle),
          location: clean(e.location),
          dateText: clean(e.dateText),
          link: clean(e.link),
          links: e.links.filter((l) => l.label.trim() || l.url),
          bullets: e.bullets.filter((b) => b.trim()).map((b) => ({ id: newId(), text: b.trim(), tags: [] })),
          tags: [],
          archived: false,
        })),
      skills: read.skills
        .filter((g) => g.skills.length)
        .map((g) => ({ id: newId(), category: g.category.trim(), skills: g.skills.map((s) => s.trim()).filter(Boolean) })),
    };
    return Response.json({ profile });
  } catch (err) {
    return handleRouteError(err);
  }
}
