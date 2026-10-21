import type { EntryLink, RenderedEntry } from '@/types/cv';

/**
 * An item brought into a CV section (from My Info, by hand, by the chat or by
 * tailoring) takes the shape of the entries already there: the fields they
 * print and nothing else, and their links by label - "Github", "Live Link" -
 * filled from the item where it has them and left as blanks where it does not,
 * for the owner to fill in on the Edit tab. Blanks are not printed.
 */

const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const isCode = (s: string) => /git(hub|lab)?|source|code|repo/i.test(s);
const isSite = (s: string) => /live|demo|site|web|app|play|store|link|url|preview/i.test(s);

/** The item's link for a label its siblings use: the same label, or one pointing at the same kind of place. */
function linkFor(label: string, links: EntryLink[], taken: Set<EntryLink>): EntryLink | undefined {
  const free = links.filter((l) => !taken.has(l) && (l.url || l.label));
  const byLabel = free.find((l) => norm(l.label) === norm(label));
  if (byLabel) return byLabel;
  if (isCode(label)) return free.find((l) => isCode(l.url) || isCode(l.label));
  if (isSite(label)) return free.find((l) => !isCode(l.url) && !isCode(l.label));
  return undefined;
}

export function shapeLike(entry: RenderedEntry, siblings: RenderedEntry[]): RenderedEntry {
  if (!siblings.length) return entry;
  const uses = (pick: (e: RenderedEntry) => unknown) => siblings.some((s) => Boolean(pick(s)));
  const labels: string[] = [];
  // The sibling with the most links sets the order ("Github • Live Link").
  const byLinks = [...siblings].sort((a, b) => (b.links?.length ?? 0) - (a.links?.length ?? 0));
  for (const s of byLinks) {
    for (const l of s.links ?? []) if (l.label.trim() && !labels.some((x) => norm(x) === norm(l.label))) labels.push(l.label);
  }
  const own = entry.links ?? [];
  const taken = new Set<EntryLink>();
  const links = labels.map((label) => {
    const found = linkFor(label, own, taken);
    if (found) taken.add(found);
    return found?.url ? { label, url: found.url } : { label, url: '', blank: true };
  });
  const bullets = uses((s) => s.bullets.some((b) => b.trim())) ? (entry.bullets.length ? entry.bullets : ['']) : [];
  return {
    ...entry,
    subtitle: uses((s) => s.subtitle) ? entry.subtitle : undefined,
    location: uses((s) => s.location) ? entry.location : undefined,
    dateText: uses((s) => s.dateText) ? entry.dateText : undefined,
    note: uses((s) => s.note) ? entry.note : undefined,
    link: uses((s) => s.link) ? entry.link : undefined,
    group: uses((s) => s.group) ? entry.group : undefined,
    links,
    bullets,
  };
}
