import { newId, slugify } from './id';
import type { ExtractionResult, ImportResult, TailorResult } from './schemas';
import type {
  CareerLibrary,
  CvDocumentData,
  DesignSpec,
  EntryLink,
  LibraryEntry,
  MatchReport,
  RenderedSection,
  SectionBaseline,
  SectionDef,
  SkillGroup,
} from '@/types/cv';

const nn = (v: string | null | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/**
 * Turns raw model output into store-shaped data, repairing the things models
 * get wrong: duplicate slugs, entries pointing at sections that do not exist,
 * and skill groups orphaned from their section.
 */
export function normalizeExtraction(raw: ExtractionResult): {
  design: DesignSpec;
  library: CareerLibrary;
} {
  const sections = dedupeSections(raw.design.sections);
  // Embedded fonts are not the model's to choose; the extract route attaches
  // them after it has saved the files.
  const design: DesignSpec = {
    ...raw.design,
    font: { ...raw.design.font, embedded: [], useEmbedded: false },
    sections,
    aligned: false,
  } as DesignSpec;

  const byId = new Map(sections.map((s) => [s.id, s]));
  const firstOfType = (type: SectionDef['type']) => sections.find((s) => s.type === type);

  const fallbackFor = (wanted: string, type: SectionDef['type']): string => {
    if (byId.has(wanted)) return wanted;
    const bySlug = sections.find((s) => s.id === slugify(wanted));
    if (bySlug) return bySlug.id;
    const byType = firstOfType(type);
    if (byType) return byType.id;
    // Nothing sensible to attach to: give the orphan a home of its own so the
    // content is never silently dropped.
    const created: SectionDef = {
      id: slugify(wanted, `section-${sections.length + 1}`),
      title: titleCase(wanted),
      type: 'extra',
      column: 'main',
    };
    sections.push(created);
    byId.set(created.id, created);
    return created.id;
  };

  const entries: LibraryEntry[] = raw.entries.map((e) => ({
    id: newId(),
    sectionId: fallbackFor(e.sectionId, 'experience'),
    title: e.title.trim(),
    subtitle: nn(e.subtitle),
    location: nn(e.location),
    dateText: nn(e.dateText),
    sortDate: nn(e.sortDate),
    link: nn(e.link),
    links: cleanLinks(e.links),
    group: nn(e.group),
    bullets: e.bullets
      .filter((b) => b.text.trim() && !isLinkRow(b.text, e.links))
      .map((b) => ({ id: newId(), text: b.text.trim(), tags: cleanTags(b.tags) })),
    tags: cleanTags(e.tags),
    archived: false,
  }));

  const skillGroups: SkillGroup[] = raw.skillGroups
    .map((g) => ({
      id: newId(),
      sectionId: fallbackFor(g.sectionId, 'skills'),
      category: g.category.trim(),
      skills: dedupe(g.skills.map((s) => s.trim()).filter(Boolean)),
      list: g.list,
      archived: false,
    }))
    .filter((g) => g.skills.length > 0);

  const summary = nn(raw.summary);

  // Measured before the user adds anything: this is what fitted on the page.
  for (const section of sections) {
    section.baseline = measureBaseline(section.id, entries, skillGroups);
  }

  const library: CareerLibrary = {
    personal: {
      fullName: raw.personal.fullName.trim(),
      headline: nn(raw.personal.headline),
      email: nn(raw.personal.email),
      phone: nn(raw.personal.phone),
      location: nn(raw.personal.location),
      links: raw.personal.links
        .filter((l) => l.label?.trim())
        .map((l) => ({
          id: newId(),
          label: l.label.trim(),
          value: l.value?.trim() || l.label.trim(),
          href: nn(l.href) ?? inferHref(l.value || l.label),
        })),
    },
    summaryVariants: summary ? [{ id: newId(), label: 'From original CV', text: summary }] : [],
    entries,
    skillGroups,
  };

  return { design: { ...design, sections }, library };
}

/** Model output from the notes importer, shaped for the library editor's draft. */
export function normalizeImport(
  raw: ImportResult,
  sectionId: string,
): { entries: LibraryEntry[]; skills: { category: string; skills: string[] }[] } {
  return {
    entries: raw.entries
      .filter((e) => e.title.trim())
      .map((e) => ({
        id: newId(),
        sectionId,
        title: e.title.trim(),
        subtitle: nn(e.subtitle),
        location: nn(e.location),
        dateText: nn(e.dateText),
        sortDate: nn(e.sortDate),
        link: nn(e.link),
        links: cleanLinks(e.links),
        bullets: e.bullets
          .filter((b) => b.text.trim())
          .map((b) => ({ id: newId(), text: b.text.trim(), tags: cleanTags(b.tags) })),
        tags: cleanTags(e.tags),
        archived: false,
      })),
    skills: raw.skills
      .map((g) => ({
        category: g.category.trim(),
        skills: dedupe(g.skills.map((s) => s.trim()).filter(Boolean)),
      }))
      .filter((g) => g.skills.length > 0),
  };
}

function measureBaseline(
  sectionId: string,
  entries: LibraryEntry[],
  groups: SkillGroup[],
): SectionBaseline {
  const own = entries.filter((e) => e.sectionId === sectionId && !e.archived);
  return {
    entries: own.length,
    maxBullets: own.reduce((n, e) => Math.max(n, e.bullets.length), 0),
    skills: groups
      .filter((g) => g.sectionId === sectionId && !g.archived)
      .reduce((n, g) => n + g.skills.length, 0),
  };
}

/**
 * The original CV's footprint for a section. Stores created before baselines
 * existed fall back to measuring the current library, which is the best
 * available approximation.
 */
export function sectionBaseline(def: SectionDef, library: CareerLibrary): SectionBaseline {
  return def.baseline ?? measureBaseline(def.id, library.entries, library.skillGroups);
}

/**
 * Hard ceilings a tailored section may not exceed. One extra entry is allowed
 * because entries vary in height; bullets and skills are capped at what the
 * original already carried so no single entry grows taller than the densest
 * one the page held.
 */
export function sectionLimits(def: SectionDef, library: CareerLibrary) {
  const b = sectionBaseline(def, library);
  return {
    entries: Math.max(1, b.entries + 1),
    bullets: Math.max(1, b.maxBullets),
    skills: Math.max(1, b.skills + 2),
  };
}

function capSkills<T extends { skills: string[] }>(groups: T[], max: number): T[] {
  let left = max;
  return groups
    .map((g) => {
      const skills = g.skills.slice(0, Math.max(0, left));
      left -= skills.length;
      return { ...g, skills };
    })
    .filter((g) => g.skills.length > 0);
}

function dedupeSections(input: SectionDef[]): SectionDef[] {
  const seen = new Set<string>();
  return input.map((s, i) => {
    let id = slugify(s.id || s.title, `section-${i + 1}`);
    let n = 2;
    while (seen.has(id)) id = `${slugify(s.id || s.title, 'section')}-${n++}`;
    seen.add(id);
    return { ...s, id, title: s.title.trim() || titleCase(id) };
  });
}

function cleanLinks(links: { label: string; url: string }[]): EntryLink[] {
  return links
    .map((l) => ({ label: l.label.trim(), url: inferHref(l.url) ?? l.url.trim() }))
    .filter((l) => l.label);
}

/**
 * Backstop for the extraction prompt: a bullet that is nothing but the
 * entry's own link labels ("Github • Live Link") is the links row read as
 * text, and would print twice.
 */
function isLinkRow(text: string, links: { label: string }[]): boolean {
  if (!links.length) return false;
  let rest = text.toLowerCase();
  for (const l of links) rest = rest.replace(l.label.toLowerCase().trim(), '');
  return !/[a-z0-9]/.test(rest);
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function cleanTags(tags: string[]): string[] {
  return dedupe(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)).slice(0, 14);
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}

function inferHref(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(v)) return `mailto:${v}`;
  if (/^[\w-]+(\.[\w-]+)+\//.test(v) || /^(www\.|github\.com|linkedin\.com)/i.test(v)) {
    return `https://${v}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------

/** The untailored CV: everything in the library, in its original order. */
export function buildBaseDocument(library: CareerLibrary, design: DesignSpec): CvDocumentData {
  const sections: RenderedSection[] = design.sections.map((def) => {
    if (def.type === 'summary') {
      return {
        sectionId: def.id,
        entries: [],
        skillGroups: [],
        summary: library.summaryVariants[0]?.text,
      };
    }
    if (def.type === 'skills') {
      return {
        sectionId: def.id,
        entries: [],
        skillGroups: library.skillGroups
          .filter((g) => g.sectionId === def.id && !g.archived)
          .map((g) => ({ groupId: g.id, category: g.category, skills: [...g.skills], list: g.list })),
      };
    }
    return {
      sectionId: def.id,
      entries: library.entries
        .filter((e) => e.sectionId === def.id && !e.archived)
        .map((e) => renderEntry(e, e.bullets.map((b) => b.id))),
      skillGroups: [],
    };
  });

  return { personal: structuredClone(library.personal), sections };
}

function renderEntry(entry: LibraryEntry, bulletIds: string[], maxBullets = Infinity) {
  const order = new Map(bulletIds.map((id, i) => [id, i]));
  const bullets = entry.bullets
    .filter((b) => order.has(b.id))
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
    .map((b) => b.text);

  return {
    entryId: entry.id,
    title: entry.title,
    subtitle: entry.subtitle,
    location: entry.location,
    dateText: entry.dateText,
    link: entry.link,
    links: (entry.links ?? []).map((l) => ({ ...l })),
    group: entry.group,
    // A heading with no body reads as a rendering bug, so fall back to the
    // entry's own bullets when the plan selected none.
    bullets: (bullets.length ? bullets : entry.bullets.map((b) => b.text)).slice(0, maxBullets),
  };
}

/**
 * Applies a tailoring plan. Anything the model referenced that does not exist
 * is ignored rather than trusted, so a bad plan degrades to the base CV instead
 * of producing a broken document.
 */
export function applyTailorPlan(
  library: CareerLibrary,
  design: DesignSpec,
  plan: TailorResult,
): { data: CvDocumentData; report: MatchReport } {
  const entryById = new Map(library.entries.filter((e) => !e.archived).map((e) => [e.id, e]));
  const groupById = new Map(library.skillGroups.filter((g) => !g.archived).map((g) => [g.id, g]));
  const bulletPlan = new Map(plan.bulletSelection.map((b) => [b.entryId, b.bulletIds]));
  const planBySection = new Map(plan.sections.map((s) => [s.sectionId, s]));

  const included: string[] = [];
  const usedEntryIds = new Set<string>();

  const sections: RenderedSection[] = design.sections.map((def) => {
    const sectionPlan = planBySection.get(def.id);

    if (def.type === 'summary') {
      const chosen =
        library.summaryVariants.find((v) => v.id === plan.summaryId) ?? library.summaryVariants[0];
      return { sectionId: def.id, entries: [], skillGroups: [], summary: chosen?.text };
    }

    const limits = sectionLimits(def, library);

    if (def.type === 'skills') {
      const available = library.skillGroups.filter((g) => g.sectionId === def.id && !g.archived);
      const keepAll = () =>
        capSkills(
          available.map((g) => ({ groupId: g.id, category: g.category, skills: [...g.skills], list: g.list })),
          limits.skills,
        );

      // No plan for this section at all means the model skipped it, not that it
      // wanted the section empty.
      if (!sectionPlan || sectionPlan.skillGroups.length === 0) {
        return { sectionId: def.id, entries: [], skillGroups: keepAll() };
      }

      // Once the model has named groups, its selection is authoritative:
      // dropping a whole group is a legitimate tailoring move, so groups it
      // left out stay out.
      const planned = sectionPlan.skillGroups
        .map((sg) => {
          const group = groupById.get(sg.groupId);
          if (!group || group.sectionId !== def.id) return null;
          // Only ever a reordering/subset of what the library already holds.
          const allowed = new Set(group.skills);
          const picked = sg.skills.filter((s) => allowed.has(s));
          if (picked.length === 0) return null;
          return { groupId: group.id, category: group.category, skills: picked, list: group.list };
        })
        .filter((g): g is NonNullable<typeof g> => g !== null);

      return {
        sectionId: def.id,
        entries: [],
        skillGroups: planned.length ? capSkills(planned, limits.skills) : keepAll(),
      };
    }

    const available = library.entries.filter((e) => e.sectionId === def.id && !e.archived);

    // Dedupe up front: `filter` below completes before `map` runs, so the
    // usedEntryIds guard alone would not catch an id repeated within one
    // section.
    const planned = Array.from(new Set(sectionPlan?.entryIds ?? []))
      .map((id) => entryById.get(id))
      .filter((e): e is LibraryEntry => Boolean(e && e.sectionId === def.id && !usedEntryIds.has(e.id)));

    // No usable plan means the model skipped the section; fall back to the
    // library's own order rather than emptying it. Either way the page limit
    // holds, so a grown library cannot spill onto a second page.
    const chosen = (planned.length ? planned : available).slice(0, limits.entries);

    const entries = chosen.map((e) => {
      usedEntryIds.add(e.id);
      included.push(`${e.title}${e.subtitle ? ` — ${e.subtitle}` : ''}`);
      const ids = (planned.length && bulletPlan.get(e.id)) || e.bullets.map((b) => b.id);
      return renderEntry(e, ids, limits.bullets);
    });

    return { sectionId: def.id, entries, skillGroups: [] };
  });

  const personal = structuredClone(library.personal);
  if (plan.headline?.trim()) personal.headline = plan.headline.trim();

  const excluded = library.entries
    .filter((e) => !e.archived && !usedEntryIds.has(e.id))
    .map((e) => `${e.title}${e.subtitle ? ` — ${e.subtitle}` : ''}`);

  const report: MatchReport = {
    roleTitle: nn(plan.roleTitle),
    company: nn(plan.company),
    matchScore: Math.max(0, Math.min(100, Math.round(plan.matchScore))),
    keywords: plan.keywords.map((k) => ({
      keyword: k.keyword,
      covered: k.covered,
      evidence: nn(k.evidence),
    })),
    included,
    excluded,
    gaps: plan.gaps.filter((g) => g.trim()),
    rationale: plan.rationale.trim(),
  };

  return { data: { personal, sections }, report };
}
