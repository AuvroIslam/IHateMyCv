import { z } from 'zod';
import type { CvDocumentData, DesignSpec } from '@/types/cv';

/**
 * Tailoring, step two: once the right material is chosen, its wording is
 * fitted to the job - the job's own terms where the facts support them, plain
 * ATS-friendly phrasing - without adding anything that is not already true,
 * and at about the same length so the page holds.
 */

export const rewriteSchema = z.object({
  headline: z.string().nullable().describe('A headline under the name for this job (one line), or null to keep the current one'),
  summary: z.string().nullable().describe('The summary reworded for this job, or null to keep it'),
  bullets: z
    .array(z.object({ ref: z.string().describe('The bullet reference, e.g. "E2.1"'), text: z.string() }))
    .describe('Only the bullets worth rewording for this job; leave out any that already fit'),
});

export const REWRITE_SYSTEM = `You reword a CV for one job. The right jobs, projects and skills are already chosen; you change only their wording, so the CV reads as written for this job and passes applicant tracking systems (ATS).

## Truth comes first

- Never add an employer, title, date, number, metric, tool, technology, responsibility or achievement that is not already in that bullet, elsewhere in the CV, or in the candidate's own facts.
- You may: use the job's exact terms for something the CV already shows ("REST APIs" for "backend endpoints" only when that is what it was), lead with the part that matters to this job, tighten, and use strong past-tense action verbs.
- When a requirement is not evidenced, leave it out. It is listed as a gap elsewhere; do not hint at it.

## ATS-friendly wording

- Spell out the job's key skills and tools the way the posting writes them, where the facts support it, so keyword scanners find them.
- Plain text: no first person in bullets, no symbols, emojis or unusual characters, no abbreviations the posting does not use.

## Shape

- Keep each bullet within about 15% of its current length: the page layout depends on it. The same goes for the summary.
- Reword only what gains from it; return nothing for bullets that already fit. Titles, dates, links and skills are not yours to change.
- The headline is one short line (under 90 characters) built only from the candidate's facts.`;

interface Ref {
  section: number;
  entry: number;
  bullet: number;
}

/** The chosen material as the model reads it, each bullet with a reference. */
export function rewriteView(data: CvDocumentData, design: DesignSpec): { text: string; refs: Map<string, Ref> } {
  const refs = new Map<string, Ref>();
  const out: string[] = [`HEADLINE: ${data.personal.headline || '(none)'}`];
  let n = 0;
  data.sections.forEach((s, si) => {
    if (s.hidden) return;
    const def = design.sections.find((d) => d.id === s.sectionId);
    if (def?.type === 'summary') {
      out.push('', `SUMMARY: ${s.summary?.trim() || '(none)'}`);
      return;
    }
    if (!s.entries.length) return;
    out.push('', `SECTION ${s.title ?? def?.title ?? s.sectionId}`);
    s.entries.forEach((e, ei) => {
      const ref = `E${++n}`;
      out.push(`  [${ref}] ${[e.title, e.subtitle, e.dateText].filter(Boolean).join(' | ')}`);
      e.bullets.forEach((b, bi) => {
        if (!b.trim()) return;
        refs.set(`${ref}.${bi + 1}`, { section: si, entry: ei, bullet: bi });
        out.push(`    [${ref}.${bi + 1}] ${b}`);
      });
    });
  });
  return { text: out.join('\n'), refs };
}

export function rewriteUserPrompt(view: string, jobDescription: string, facts: string): string {
  return [
    `<job>\n${jobDescription}\n</job>`,
    `<cv>\n${view}\n</cv>`,
    facts.trim() ? `<candidate_facts>\n${facts.trim()}\n</candidate_facts>` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Within reason of the old length: a rewrite that grew or shrank too far would reflow the page. */
const fits = (before: string, after: string) => {
  if (before.length < 40) return after.length <= before.length * 1.6 + 10;
  return after.length <= before.length * 1.3 && after.length >= before.length * 0.6;
};

/** Applies the rewording; returns what changed, in words for the Job match tab. */
export function applyRewrite(
  data: CvDocumentData,
  design: DesignSpec,
  refs: Map<string, Ref>,
  result: z.infer<typeof rewriteSchema>,
): string[] {
  const changes: string[] = [];
  const headline = result.headline?.trim();
  if (headline && headline.length <= 120 && headline !== data.personal.headline?.trim()) {
    data.personal.headline = headline;
    changes.push('Wrote a headline for this job');
  }
  const summarySection = data.sections.find((s) => design.sections.find((d) => d.id === s.sectionId)?.type === 'summary');
  const summary = result.summary?.trim();
  if (summarySection?.summary && summary && summary !== summarySection.summary.trim() && fits(summarySection.summary, summary)) {
    summarySection.summary = summary;
    // Reworded, the original's line breaks no longer apply.
    summarySection.summaryLines = undefined;
    summarySection.summaryParagraphs = undefined;
    changes.push('Reworded the summary');
  }
  const perEntry = new Map<string, number>();
  for (const b of result.bullets) {
    const ref = refs.get(b.ref.trim().replace(/^\[|\]$/g, ''));
    const text = b.text.trim();
    if (!ref || !text) continue;
    const entry = data.sections[ref.section]?.entries[ref.entry];
    const before = entry?.bullets[ref.bullet];
    if (!entry || before === undefined || before.trim() === text || !fits(before, text)) continue;
    entry.bullets[ref.bullet] = text;
    perEntry.set(entry.title || 'an entry', (perEntry.get(entry.title || 'an entry') ?? 0) + 1);
  }
  for (const [title, count] of perEntry) changes.push(`Reworded ${count} bullet${count > 1 ? 's' : ''} in ${title}`);
  return changes;
}
