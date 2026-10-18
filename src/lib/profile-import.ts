import { newId } from '@/lib/id';
import { norm, normalizeProfile, sameItem } from '@/lib/profile';
import type { ContactLink, LibraryEntry, Profile, ProfileSkills } from '@/types/cv';

/**
 * Bringing information from CVs into My Info. What is new is offered as an
 * addition; what differs from what My Info already says is a question, and
 * nothing changes until the owner has chosen.
 */

export type DetailKey = 'fullName' | 'headline' | 'email' | 'phone' | 'location' | 'summary';

export const DETAIL_LABEL: Record<DetailKey, string> = {
  fullName: 'Name',
  headline: 'Headline',
  email: 'Email',
  phone: 'Phone',
  location: 'Location',
  summary: 'Summary',
};

export interface ImportPlan {
  /** Blank in My Info, given by the CV: filled in. */
  fills: { key: DetailKey; value: string }[];
  /** Said differently by My Info and the CVs (or by two CVs): which to keep? The first option is My Info's, when it has one. */
  details: { key: DetailKey; options: { value: string; from: string }[] }[];
  newLinks: ContactLink[];
  changedLinks: { label: string; current: string; incoming: string }[];
  newFacts: string[];
  newEntries: LibraryEntry[];
  /** The same item, said differently. */
  changedEntries: { current: LibraryEntry; incoming: LibraryEntry; adds: string[] }[];
  newSkills: { category: string; skills: string[] }[];
}

export type EntryChoice = 'current' | 'incoming' | 'both';

export interface ImportChoices {
  /** Index into the detail's options. */
  details: Record<string, number>;
  newLinks: Record<string, boolean>;
  changedLinks: Record<string, 'current' | 'incoming'>;
  newFacts: Record<number, boolean>;
  newEntries: Record<string, boolean>;
  changedEntries: Record<string, EntryChoice>;
  newSkills: Record<string, boolean>;
}

export const planIsEmpty = (p: ImportPlan) =>
  !p.fills.length &&
  !p.details.length &&
  !p.newLinks.length &&
  !p.changedLinks.length &&
  !p.newFacts.length &&
  !p.newEntries.length &&
  !p.changedEntries.length &&
  !p.newSkills.length;

const detail = (p: Profile, key: DetailKey) => (key === 'summary' ? p.summary : p.personal[key]) ?? '';

/** The same detail written differently: a phone number with or without its country code, or case and punctuation. */
function sameDetail(key: DetailKey, a: string, b: string): boolean {
  if (key === 'phone') {
    const digits = (s: string) => s.replace(/\D/g, '').slice(-10);
    return digits(a).length >= 7 && digits(a) === digits(b);
  }
  return norm(a) === norm(b);
}
const linkTarget = (l: ContactLink) => (l.href || l.value || '').trim();

/** A link's address without what does not change where it goes (tracking query, fragment, trailing slash, case). */
export function sameUrl(a: string | undefined, b: string | undefined): boolean {
  const key = (u: string | undefined) => {
    const s = (u ?? '').trim();
    if (!s) return '';
    try {
      const url = new URL(/^[a-z]+:/i.test(s) ? s : `https://${s}`);
      return `${url.hostname.replace(/^www\./, '').toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      return s.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
    }
  };
  return Boolean(key(a)) && key(a) === key(b);
}

const sameLink = (a: { label: string; url: string }, b: { label: string; url: string }) =>
  (norm(a.label) && norm(a.label) === norm(b.label)) || sameUrl(a.url, b.url);
const factLines = (about: string) => about.split('\n').map((l) => l.trim()).filter(Boolean);
const bulletSet = (e: LibraryEntry) => new Set(e.bullets.map((b) => norm(b.text)).filter(Boolean));

/** What the CV would add to an item My Info already has, in words for the review ("2 new bullets", "dates"). */
function additions(current: LibraryEntry, incoming: LibraryEntry): string[] {
  const out: string[] = [];
  const have = bulletSet(current);
  const newBullets = incoming.bullets.filter((b) => b.text.trim() && !have.has(norm(b.text))).length;
  if (newBullets) out.push(`${newBullets} new bullet${newBullets > 1 ? 's' : ''}`);
  const links = incoming.links.filter((l) => (l.url || l.label) && !current.links.some((c) => sameLink(c, l))).length;
  if (links) out.push(`${links} new link${links > 1 ? 's' : ''}`);
  const moved = incoming.links.filter((l) =>
    current.links.some((c) => norm(c.label) && norm(c.label) === norm(l.label) && c.url && l.url && !sameUrl(c.url, l.url)),
  ).length;
  if (moved) out.push(`${moved} link${moved > 1 ? 's' : ''} pointing somewhere else`);
  for (const [k, label] of [
    ['dateText', 'dates'],
    ['subtitle', 'organisation'],
    ['location', 'location'],
  ] as const) {
    if (incoming[k]?.trim() && norm(incoming[k]) !== norm(current[k])) out.push(current[k]?.trim() ? `different ${label}` : label);
  }
  return out;
}

/** Several CVs read as one: each item once, with everything any of them said about it. */
export function combineIncoming(list: Profile[]): Profile {
  const out = normalizeProfile(null);
  for (const raw of list.map(normalizeProfile)) {
    for (const key of ['fullName', 'headline', 'email', 'phone', 'location'] as const) {
      if (!out.personal[key]?.trim() && raw.personal[key]?.trim()) out.personal[key] = raw.personal[key];
    }
    if (!out.summary?.trim() && raw.summary?.trim()) out.summary = raw.summary;
    for (const l of raw.personal.links) {
      if (!out.personal.links.some((x) => norm(x.label) === norm(l.label))) out.personal.links.push(l);
    }
    const facts = factLines(out.about);
    for (const f of factLines(raw.about)) if (!facts.some((x) => norm(x) === norm(f))) facts.push(f);
    out.about = facts.join('\n');
    for (const e of raw.entries) {
      const i = out.entries.findIndex((x) => x.sectionId === e.sectionId && sameItem(x, e));
      out.entries = i < 0 ? [...out.entries, e] : out.entries.map((x, j) => (j === i ? combineEntries(x, e) : x));
    }
    for (const g of raw.skills ?? []) out.skills = mergeSkills(out.skills ?? [], g.category, g.skills);
  }
  return out;
}

function mergeSkills(groups: ProfileSkills[], category: string, skills: string[]): ProfileSkills[] {
  const i = groups.findIndex((g) => norm(g.category) === norm(category));
  if (i < 0) return [...groups, { id: newId(), category, skills: [...skills] }];
  const have = new Set(groups[i].skills.map(norm));
  return groups.map((g, j) => (j === i ? { ...g, skills: [...g.skills, ...skills.filter((s) => !have.has(norm(s)))] } : g));
}

/** One item with both versions' details: the current one's words first, anything new from the other after. */
export function combineEntries(current: LibraryEntry, incoming: LibraryEntry): LibraryEntry {
  const have = bulletSet(current);
  return {
    ...current,
    subtitle: current.subtitle?.trim() ? current.subtitle : incoming.subtitle,
    location: current.location?.trim() ? current.location : incoming.location,
    dateText: current.dateText?.trim() ? current.dateText : incoming.dateText,
    link: current.link || incoming.link,
    links: [
      // A link My Info has without an address takes the CV's.
      ...current.links.map((c) => (c.url ? c : { ...c, url: incoming.links.find((l) => sameLink(c, l))?.url ?? '' })),
      ...incoming.links.filter((l) => (l.url || l.label) && !current.links.some((c) => sameLink(c, l))),
    ],
    bullets: [
      ...current.bullets,
      ...incoming.bullets.filter((b) => b.text.trim() && !have.has(norm(b.text))).map((b) => ({ ...b, id: newId() })),
    ],
  };
}

/** Compares what the CVs say with what My Info says. Each CV comes with the name it is shown by. */
export function planImport(currentRaw: Profile, sources: { profile: Profile; from: string }[]): ImportPlan {
  const current = normalizeProfile(currentRaw);
  const incoming = combineIncoming(sources.map((s) => s.profile));
  const plan: ImportPlan = {
    fills: [],
    details: [],
    newLinks: [],
    changedLinks: [],
    newFacts: [],
    newEntries: [],
    changedEntries: [],
    newSkills: [],
  };

  for (const key of Object.keys(DETAIL_LABEL) as DetailKey[]) {
    const now = detail(current, key).trim();
    // Every distinct version the CVs give, with the first CV that gave it.
    const offered: { value: string; from: string }[] = [];
    for (const s of sources) {
      const value = detail(normalizeProfile(s.profile), key).trim();
      if (value && !sameDetail(key, value, now) && !offered.some((o) => sameDetail(key, o.value, value))) offered.push({ value, from: s.from });
    }
    if (!offered.length) continue;
    if (!now && offered.length === 1) plan.fills.push({ key, value: offered[0].value });
    else plan.details.push({ key, options: [...(now ? [{ value: now, from: 'My Info' }] : []), ...offered] });
  }

  for (const l of incoming.personal.links) {
    if (!l.label.trim() && !linkTarget(l)) continue;
    const mine = current.personal.links.find((x) => norm(x.label) === norm(l.label));
    if (!mine) {
      if (!current.personal.links.some((x) => sameUrl(linkTarget(x), linkTarget(l)))) plan.newLinks.push(l);
    } else if (linkTarget(l) && linkTarget(mine) && !sameUrl(linkTarget(l), linkTarget(mine))) {
      plan.changedLinks.push({ label: mine.label, current: linkTarget(mine), incoming: linkTarget(l) });
    }
  }

  const facts = factLines(current.about).map(norm);
  plan.newFacts = factLines(incoming.about).filter((f) => !facts.includes(norm(f)));

  for (const e of incoming.entries) {
    const mine = current.entries.find((x) => x.sectionId === e.sectionId && sameItem(x, e));
    if (!mine) plan.newEntries.push(e);
    else {
      const adds = additions(mine, e);
      if (adds.length) plan.changedEntries.push({ current: mine, incoming: e, adds });
    }
  }

  for (const g of incoming.skills ?? []) {
    const mine = (current.skills ?? []).find((x) => norm(x.category) === norm(g.category));
    const have = new Set((mine?.skills ?? []).map(norm));
    const fresh = g.skills.filter((s) => s.trim() && !have.has(norm(s)));
    if (fresh.length) plan.newSkills.push({ category: mine?.category ?? g.category, skills: fresh });
  }
  return plan;
}

/** The choices a review starts from: everything new is in; where versions differ, My Info's stays until changed. */
export function defaultChoices(plan: ImportPlan): ImportChoices {
  return {
    details: Object.fromEntries(plan.details.map((d) => [d.key, 0])),
    newLinks: Object.fromEntries(plan.newLinks.map((l) => [l.label, true])),
    changedLinks: Object.fromEntries(plan.changedLinks.map((l) => [l.label, 'current'])),
    newFacts: Object.fromEntries(plan.newFacts.map((_, i) => [i, true])),
    newEntries: Object.fromEntries(plan.newEntries.map((e) => [e.id, true])),
    changedEntries: Object.fromEntries(plan.changedEntries.map((c) => [c.current.id, 'both'])),
    newSkills: Object.fromEntries(plan.newSkills.map((s) => [s.category, true])),
  };
}

/** My Info with the chosen changes made. */
export function applyImport(currentRaw: Profile, plan: ImportPlan, choices: ImportChoices): Profile {
  const next = structuredClone(normalizeProfile(currentRaw));
  const set = (key: DetailKey, value: string) => {
    if (key === 'summary') next.summary = value;
    else next.personal[key] = value;
  };
  for (const f of plan.fills) set(f.key, f.value);
  for (const d of plan.details) set(d.key, d.options[choices.details[d.key] ?? 0]?.value ?? d.options[0].value);

  for (const l of plan.newLinks) if (choices.newLinks[l.label]) next.personal.links.push({ ...l, id: newId() });
  for (const c of plan.changedLinks) {
    if (choices.changedLinks[c.label] !== 'incoming') continue;
    next.personal.links = next.personal.links.map((l) => (norm(l.label) === norm(c.label) ? { ...l, value: c.incoming, href: c.incoming } : l));
  }

  const facts = plan.newFacts.filter((_, i) => choices.newFacts[i]);
  if (facts.length) next.about = [next.about.trim(), ...facts].filter(Boolean).join('\n');

  for (const c of plan.changedEntries) {
    const choice = choices.changedEntries[c.current.id] ?? 'both';
    if (choice === 'current') continue;
    next.entries = next.entries.map((e) =>
      e.id !== c.current.id ? e : choice === 'incoming' ? { ...c.incoming, id: e.id } : combineEntries(e, c.incoming),
    );
  }
  for (const e of plan.newEntries) if (choices.newEntries[e.id]) next.entries.push({ ...e, id: newId() });

  for (const s of plan.newSkills) if (choices.newSkills[s.category]) next.skills = mergeSkills(next.skills ?? [], s.category, s.skills);
  return next;
}
