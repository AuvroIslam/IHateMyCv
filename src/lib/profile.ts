import { newId } from '@/lib/id';
import type {
  CareerLibrary,
  CvDocumentData,
  DesignSpec,
  LibraryBullet,
  LibraryEntry,
  Profile,
  ProfileKind,
  SkillGroup,
  SummaryVariant,
} from '@/types/cv';

/**
 * The Profile ("My Info"): everything about the owner, apart from any CV.
 * It is never printed as it is. Tailoring and the chat see it merged over the
 * Career Library the upload produced (withProfile): where both hold the same
 * project or job, the Profile's version wins, and once a kind of item is in
 * the Profile, the Profile decides which of them exist.
 */

export const PROFILE_KINDS: { kind: ProfileKind; label: string; one: string }[] = [
  { kind: 'experience', label: 'Experience', one: 'job' },
  { kind: 'projects', label: 'Projects', one: 'project' },
  { kind: 'achievements', label: 'Achievements', one: 'achievement' },
  { kind: 'education', label: 'Education', one: 'degree or course' },
];

export const emptyProfile = (): Profile => ({
  personal: { fullName: '', links: [] },
  summary: '',
  about: '',
  entries: [],
  skills: [],
});

/** A stored profile with every field present (older profiles lack summary and skills). */
export function normalizeProfile(p: Profile | null | undefined): Profile {
  if (!p) return emptyProfile();
  return { ...emptyProfile(), ...p, summary: p.summary ?? '', skills: p.skills ?? [], personal: { ...p.personal, links: p.personal.links ?? [] } };
}

export const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 1));

/** The same project or job, worded perhaps a little differently ("Intern, Unity Game Developer" vs "Unity Game Developer"). */
export function sameItem(a: Pick<LibraryEntry, 'title' | 'subtitle'>, b: Pick<LibraryEntry, 'title' | 'subtitle'>): boolean {
  if (norm(a.title) && norm(a.title) === norm(b.title)) return true;
  const x = words(`${a.title} ${a.subtitle ?? ''}`);
  const y = words(`${b.title} ${b.subtitle ?? ''}`);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.min(x.size, y.size) >= 0.75 && shared / Math.max(x.size, y.size) >= 0.5;
}

const kindOfType = (type: string): ProfileKind | null =>
  PROFILE_KINDS.some((k) => k.kind === type) ? (type as ProfileKind) : null;

/** The uploaded CV's content in Profile form: its details, summary, items and skills. */
export function profileFromLibrary(library: CareerLibrary, design: DesignSpec): Profile {
  const kindOf = new Map(design.sections.flatMap((s) => {
    const kind = kindOfType(s.type);
    return kind ? [[s.id, kind] as const] : [];
  }));
  return {
    personal: structuredClone(library.personal),
    summary: library.summaryVariants[0]?.text ?? '',
    about: '',
    entries: library.entries.flatMap((e) => {
      const kind = kindOf.get(e.sectionId);
      if (!kind || e.archived || (!e.title.trim() && !e.bullets.length)) return [];
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
    skills: library.skillGroups
      .filter((g) => !g.archived && g.skills.length)
      .map((g) => ({ id: newId(), category: g.category, skills: [...g.skills] })),
  };
}

/** Bullets as the Profile words them, keeping the library's own record (and its print details) where the words are the same. */
function mergeBullets(own: LibraryBullet[], profile: LibraryBullet[]): LibraryBullet[] {
  const byText = new Map(own.map((b) => [norm(b.text), b]));
  return profile
    .filter((b) => b.text.trim())
    .map((b) => byText.get(norm(b.text)) ?? { id: `p-${b.id}`, text: b.text.trim(), tags: b.tags ?? [] });
}

/**
 * The Career Library as tailoring and the chat should see it, with the
 * Profile over it. Facts that have no place as entries (the free-form
 * "about", items with no section of their kind on this CV, extra links) come
 * back as text: true and usable, but not entries.
 */
export function withProfile(
  library: CareerLibrary,
  design: DesignSpec,
  stored: Profile | null | undefined,
): { library: CareerLibrary; facts: string } {
  if (!stored) return { library, facts: '' };
  const profile = normalizeProfile(stored);
  const entries = library.entries.map((e) => ({ ...e }));
  const loose: string[] = [];
  const matched = new Set<string>();

  for (const p of profile.entries) {
    if (!p.title.trim() && !p.bullets.some((b) => b.text.trim())) continue;
    const sections = design.sections.filter((s) => s.type === p.sectionId);
    if (!sections.length) {
      const kind = PROFILE_KINDS.find((k) => k.kind === p.sectionId)?.one ?? 'item';
      loose.push(`- ${kind}: ${[p.title, p.subtitle, p.dateText].filter(Boolean).join(', ')}${p.bullets.length ? ` - ${p.bullets.map((b) => b.text).join(' ')}` : ''}`);
      continue;
    }
    const ids = new Set(sections.map((s) => s.id));
    const i = entries.findIndex((e) => ids.has(e.sectionId) && !matched.has(e.id) && sameItem(e, p));
    if (i >= 0) {
      const own = entries[i];
      matched.add(own.id);
      entries[i] = {
        ...own,
        title: p.title,
        subtitle: p.subtitle,
        location: p.location,
        dateText: p.dateText,
        link: p.link,
        links: p.links,
        bullets: mergeBullets(own.bullets, p.bullets),
        archived: false,
      };
    } else {
      const id = `p-${p.id}`;
      matched.add(id);
      entries.push({
        ...p,
        id,
        sectionId: sections[0].id,
        group: undefined,
        bullets: mergeBullets([], p.bullets),
        tags: p.tags ?? [],
        archived: false,
      });
    }
  }
  // A kind the Profile holds is the Profile's to decide: what was removed there stays out.
  const held = new Set(profile.entries.map((e) => e.sectionId));
  const typeOf = new Map(design.sections.map((s) => [s.id, s.type]));
  for (const e of entries) {
    const kind = kindOfType(typeOf.get(e.sectionId) ?? '');
    if (kind && held.has(kind) && !matched.has(e.id)) e.archived = true;
  }

  let skillGroups: SkillGroup[] = library.skillGroups;
  const skillSection = design.sections.find((s) => s.type === 'skills');
  if (profile.skills?.length && skillSection) {
    const used = new Set<string>();
    skillGroups = profile.skills
      .filter((g) => g.skills.length)
      .map((g) => {
        const own = library.skillGroups.find((x) => !used.has(x.id) && norm(x.category) === norm(g.category));
        if (own) used.add(own.id);
        return own
          ? { ...own, category: g.category, skills: [...g.skills], archived: false }
          : { id: `p-${g.id}`, sectionId: skillSection.id, category: g.category, skills: [...g.skills], archived: false };
      });
    skillGroups = [...skillGroups, ...library.skillGroups.filter((g) => !used.has(g.id)).map((g) => ({ ...g, archived: true }))];
  }

  let summaryVariants: SummaryVariant[] = library.summaryVariants;
  const summary = profile.summary?.trim();
  if (summary && !library.summaryVariants.some((v) => norm(v.text) === norm(summary))) {
    summaryVariants = [{ id: 'p-summary', label: 'From My Info', text: summary }, ...library.summaryVariants];
  } else if (summary) {
    // The same words: offer the library's copy first, which keeps its line breaks.
    const same = library.summaryVariants.find((v) => norm(v.text) === norm(summary))!;
    summaryVariants = [same, ...library.summaryVariants.filter((v) => v !== same)];
  }

  // Contact details the CV prints follow My Info; links only update the ones
  // the header already prints (its layout names them by position).
  const pp = profile.personal;
  const personal = { ...library.personal };
  if (pp.fullName.trim()) personal.fullName = pp.fullName;
  for (const k of ['headline', 'email', 'phone', 'location'] as const) if (pp[k]?.trim()) personal[k] = pp[k];
  personal.links = library.personal.links.map((l) => {
    const p = pp.links.find((x) => norm(x.label) === norm(l.label));
    // The printed text stays; the target follows My Info.
    return p ? { ...l, href: p.href || p.value || l.href } : l;
  });
  const extraLinks = pp.links.filter((x) => !library.personal.links.some((l) => norm(l.label) === norm(x.label)));

  const facts = [
    profile.about.trim(),
    extraLinks.length ? extraLinks.map((l) => `Link: ${[l.label, l.href || l.value].filter(Boolean).join(' - ')}`).join('\n') : '',
    loose.length ? `Not shown in any section of this CV:\n${loose.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { library: { ...library, personal, entries, skillGroups, summaryVariants }, facts };
}

/**
 * A CV's own content in My Info form - what that CV says, as printed: its
 * details, summary, items by kind and skills. Sections of no kind My Info
 * keeps (Additional information, Languages...) become facts, one per line.
 */
export function profileFromDocument(data: CvDocumentData, design: DesignSpec): Profile {
  const out = emptyProfile();
  out.personal = structuredClone(data.personal);
  const facts: string[] = [];
  for (const s of data.sections) {
    if (s.hidden) continue;
    const def = design.sections.find((d) => d.id === s.sectionId);
    const title = s.title ?? def?.title ?? '';
    const kind = kindOfType(def?.type ?? '');
    if (def?.type === 'summary') {
      if (s.summary?.trim()) out.summary = s.summary.trim();
      continue;
    }
    for (const g of s.skillGroups) {
      if (g.skills.length) out.skills = [...(out.skills ?? []), { id: newId(), category: g.category, skills: [...g.skills] }];
    }
    for (const e of s.entries) {
      if (kind) {
        out.entries.push({
          id: newId(),
          sectionId: kind,
          title: e.title,
          subtitle: e.subtitle,
          location: e.location,
          dateText: e.dateText,
          note: e.note,
          link: e.link,
          links: (e.links ?? []).filter((l) => l.url || !l.blank).map(({ label, url }) => ({ label, url })),
          bullets: e.bullets.filter((b) => b.trim()).map((text) => ({ id: newId(), text, tags: [] })),
          tags: [],
          archived: false,
        });
      } else {
        const text = [e.title, e.subtitle, e.dateText, ...e.bullets].filter((x) => x?.trim()).join(' - ');
        if (text) facts.push(`${title.charAt(0) + title.slice(1).toLowerCase()}: ${text}`);
      }
    }
  }
  out.about = facts.join('\n');
  return out;
}
