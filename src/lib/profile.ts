import { newId } from '@/lib/id';
import type { CareerLibrary, DesignSpec, LibraryEntry, Profile, ProfileKind } from '@/types/cv';

/**
 * The Profile: general information about the owner, apart from any CV. It is
 * never printed as it is; tailoring and the chat see it merged into the
 * Career Library (withProfile), each item under the CV section of its kind.
 */

export const PROFILE_KINDS: { kind: ProfileKind; label: string; one: string }[] = [
  { kind: 'projects', label: 'Projects', one: 'project' },
  { kind: 'experience', label: 'Experience', one: 'job' },
  { kind: 'achievements', label: 'Achievements', one: 'achievement' },
];

export const emptyProfile = (): Profile => ({
  personal: { fullName: '', links: [] },
  about: '',
  entries: [],
});

const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A first Profile copied from the uploaded CV: its details, and every project, job and achievement. */
export function profileFromLibrary(library: CareerLibrary, design: DesignSpec): Profile {
  const kindOf = new Map(
    design.sections.flatMap((s) => (PROFILE_KINDS.some((k) => k.kind === s.type) ? [[s.id, s.type as ProfileKind]] : [])),
  );
  return {
    personal: structuredClone(library.personal),
    about: '',
    entries: library.entries.flatMap((e) => {
      const kind = kindOf.get(e.sectionId);
      if (!kind || e.archived) return [];
      return [
        {
          ...structuredClone(e),
          id: newId(),
          sectionId: kind,
          group: undefined,
          bullets: e.bullets.map((b) => ({ id: newId(), text: b.text, tags: b.tags })),
        },
      ];
    }),
  };
}

/**
 * The Career Library with the Profile's items added as candidates, each in
 * the CV's section of its kind, skipping any the library already holds (same
 * title in that section). Items with no such section on this CV, and the
 * free-form "about", come back as facts: true, usable, but not entries.
 */
export function withProfile(
  library: CareerLibrary,
  design: DesignSpec,
  profile: Profile | null | undefined,
): { library: CareerLibrary; facts: string } {
  if (!profile) return { library, facts: '' };
  const added: LibraryEntry[] = [];
  const loose: string[] = [];
  for (const e of profile.entries) {
    if (!e.title.trim() && !e.bullets.some((b) => b.text.trim())) continue;
    const section = design.sections.find((s) => s.type === e.sectionId);
    if (!section) {
      const kind = PROFILE_KINDS.find((k) => k.kind === e.sectionId)?.one ?? 'item';
      loose.push(`- ${kind}: ${[e.title, e.subtitle, e.dateText].filter(Boolean).join(', ')}${e.bullets.length ? ` - ${e.bullets.map((b) => b.text).join(' ')}` : ''}`);
      continue;
    }
    if (library.entries.some((x) => x.sectionId === section.id && norm(x.title) === norm(e.title))) continue;
    added.push({
      ...e,
      id: `p-${e.id}`,
      sectionId: section.id,
      bullets: e.bullets.filter((b) => b.text.trim()).map((b) => ({ ...b, tags: b.tags ?? [] })),
      tags: e.tags ?? [],
      archived: false,
    });
  }
  const p = profile.personal;
  const contact = [
    p.headline && `Headline they use: ${p.headline}`,
    p.location && `Location: ${p.location}`,
    ...p.links.filter((l) => l.label || l.value).map((l) => `Link: ${[l.label, l.value].filter(Boolean).join(' - ')}`),
  ].filter(Boolean) as string[];
  const facts = [
    profile.about.trim(),
    contact.length ? contact.join('\n') : '',
    loose.length ? `Not shown in any section of this CV:\n${loose.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { library: { ...library, entries: [...library.entries, ...added] }, facts };
}
