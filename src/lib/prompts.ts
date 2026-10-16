import { sectionBaseline, sectionLimits } from './assemble';
import { fontCatalogueForPrompt } from './fonts';
import type { CareerLibrary, DesignSpec, SectionDef } from '@/types/cv';

const SOURCE_NOTE = `You are given a text layout dump of the PDF: one line per text line, with x/y in points from the top-left of the page (y = baseline), the text height in points and the embedded font name. After each page come its clickable links and the measured space around standalone separator glyphs.`;

const ORG_TITLE_RULE = `If an entry's heading is ONE line holding both the organisation and the role joined by a dash ("Ostad – Teaching Assistant, React Native"), the organisation is the subtitle and the role is the title.`;

/** Upload, call 1 of 2: the look. Runs in parallel with CONTENT_SYSTEM. */
export const DESIGN_SYSTEM = `You measure the visual design of a CV precisely enough that it can be rebuilt pixel-close in HTML. You do not extract its content - a separate pass does that.

${SOURCE_NOTE} Page images follow. Use the images to judge style (alignment, rules, weight, colour) and the coordinates to get numbers right.

## Rules

- Derive point sizes from the dump, not by guessing. Derive margins from the outermost text positions; 1pt = 0.3528mm.
- Copy the exact bullet glyph and contact separator glyph.
- Pick font keys from this catalogue, matching the embedded font names first:

${fontCatalogueForPrompt()}

- LaTeX's default face (CMR10, CMBX10, SFRM1000, LMRoman...) is "computer-modern" - much wider than Times. Only NimbusRoman / Times names map to "times".
- No rule under a heading: rulePt 0 and style "plain".
- Colours come from the image. Most CVs are black on white - do not invent an accent. Links are often coloured: capture that in color.link.
- bulletIndentPt is the bullet glyph's x minus the left margin; bulletTextIndentPt is where the bullet's text starts. Justified text has a straight right edge.
- Header: record the order of contact items, labels printed before values ("Phone:"), and copy the measured separator gaps into contactGapPt and linkGapPt.
- Spacing is refined automatically afterwards by measuring the rebuild, so get it close and spend your effort on choosing the right layouts.

## Layouts to recognise

- ${ORG_TITLE_RULE} Such entries use layout "org-title", with the date right and the location alone on the next line.
- Sub-headings inside a section (e.g. "National" / "International") are styled by entry.groupLabel.
- Skills printed as a grid of categories (each label on its own line, items below) use layout "columns" with the column count.
- A row under an entry made only of link labels ("Github • Live Link") sets entry.linksPlacement to how it is printed.`;

/** Upload, call 2 of 2: the words. Runs in parallel with DESIGN_SYSTEM. */
export const CONTENT_SYSTEM = `You extract every reusable component of a CV as structured data. Another pass measures the visual design; you only capture content and its structure.

${SOURCE_NOTE}

## Sections

- List every section in top-to-bottom reading order, with the heading text copied EXACTLY as printed (keep "WORK EXPERIENCE", do not normalise to "Experience").
- In a two-column layout, mark each section's column ("main"/"side") from its x position.
- A section you cannot classify ("Leadership & Activities", "Publications") is type "extra".
- Every entry and skill group references a section id from your list.

## Content

- Copy all text VERBATIM: bullets, titles, dates ("Jun 2023 - Aug 2023"). Never rewrite, shorten or "improve" - it is reused as-is. Leave out the bullet glyph itself.
- A line under a heading printed WITHOUT a bullet glyph (a detail such as "2nd Runners-Up" or "Current CGPA: 3.64") is still one of that entry's bullets.
- Hyphenation at line ends is not part of a word: "devel-" + "opment" is "development".
- ${ORG_TITLE_RULE} Otherwise the title is the line printed first or most prominently and the subtitle the secondary line.
- Sub-headings inside a section (e.g. "National" / "International" splitting Achievements) are NOT entries and NOT locations: put the label in each entry's group field.
- A section that is only a bulleted list with no entry headings (certifications, a bulleted summary or "Summary of Qualifications") is one entry with an EMPTY title holding the items as its bullets. Never drop such a section. A summary printed as bullets is type "extra", not "summary".
- Skills keep their original grouping and category labels ("" if none). When a category prints its items as bullets, set list=true and make each bullet line one item, verbatim.
- The summary is ALL of the summary text: a summary of two or three paragraphs keeps every one, separated by a blank line.
- If the CV has no summary, return null. Never invent content.

## Links

The LINKS lists are the only source of URLs: printed CVs hide them behind labels like "LinkedIn" or "Live Link".
- Personal links: set href from the matching LINKS entry.
- A row under an entry made only of link labels ("Github • Live Link") is NOT a bullet. Put each label in that entry's links with its URL, matched by y - the row belongs to the entry above it.
- If the title itself is clickable, its URL goes in the entry's link field.
- Never invent a URL; a label with no LINKS entry keeps an empty url.`;

/** Background, after upload: keywords for job matching. Never displayed. */
export const TAGS_SYSTEM = `You write matching keywords for CV entries. They are never shown to anyone; a later pass uses them to score how relevant each entry and bullet is to a job description. Be generous and specific: technologies, methods, domains and transferable skills, all lowercase. Return one item per entry, keyed by its index, with one keyword list per bullet in order.`;

export function designUserPrompt(textDump: string, pageCount: number): string {
  return `This CV has ${pageCount} page(s).

\`\`\`
${textDump}
\`\`\`

The page images follow. Measure the design.`;
}

export function contentUserPrompt(textDump: string, pageCount: number): string {
  return `This CV has ${pageCount} page(s).

\`\`\`
${textDump}
\`\`\`

Extract every section and component.`;
}

export function tagsUserPrompt(entries: { title: string; subtitle?: string; bullets: string[] }[]): string {
  return JSON.stringify(
    entries.map((e, index) => ({ index, title: e.title, subtitle: e.subtitle ?? null, bullets: e.bullets })),
    null,
    1,
  );
}

export const IMPORT_SYSTEM = `You turn someone's rough notes about their own work into entries for their Career Library - the pool of material their CV is assembled from.

- Use only facts present in the notes. Never invent metrics, technologies, employers, dates, or outcomes. If the notes give no number, the bullet has no number.
- Write bullets that read like the person's existing bullets, which you are shown: match their length, tense, punctuation, and whether they lead with a verb. The new material has to sit on the same page as the old without looking pasted in.
- Notes are written in the first person ("I built", "my club"); CV bullets are not. Drop pronouns unless the existing bullets use them, and never repeat the entry's own title or tech stack as a bullet - the heading already says it. Each bullet should state what was done and what it achieved.
- One bullet per distinct accomplishment. Prefer 2-5 bullets per entry; do not pad thin notes out to fill a quota.
- Write generous, specific tags. They are never printed; they exist so a later job-matching pass can find this material.
- If the notes describe several distinct jobs or projects, return one entry each.
- For a skills section, return skills only, sorted into the existing categories where they fit. Leave out skills the library already lists.`;

export function importUserPrompt(
  library: CareerLibrary,
  section: SectionDef,
  notes: string,
): string {
  const styleSamples = library.entries
    .flatMap((e) => e.bullets.map((b) => b.text))
    .filter(Boolean)
    .slice(0, 12);
  const dateSamples = Array.from(
    new Set(library.entries.map((e) => e.dateText).filter(Boolean)),
  ).slice(0, 5);

  const context =
    section.type === 'skills'
      ? `Existing skill groups in this section:\n${library.skillGroups
          .filter((g) => g.sectionId === section.id)
          .map((g) => `- ${g.category || '(ungrouped)'}: ${g.skills.join(', ')}`)
          .join('\n')}`
      : `Existing bullets, for voice and length:\n${styleSamples.map((t) => `- ${t}`).join('\n')}\n\nDate format in use: ${dateSamples.join('; ') || 'none yet'}`;

  return `Target section: "${section.title}" (type: ${section.type})

${context}

## Notes

\`\`\`
${notes}
\`\`\``;
}

export const TAILOR_SYSTEM =`You are a CV tailoring engine. You select which components from a Career Library belong on a CV for one specific job.

## Hard constraints

- You may ONLY select, drop, and reorder. You may NOT write new bullet text, rename entries, or edit any wording. Every bullet that appears on the tailored CV must be an existing bullet id from the library.
- You may NOT reorder or rename the CV's sections. Section order and section titles are part of the design and are fixed. Within a section you may reorder entries, and in a skills section you may reorder the skill groups themselves (lead with the group the job cares about most) as well as the skills within each group.
- Keep the tailored CV the same length as the original. For each section you are given what the ORIGINAL CV showed and a hard cap. The library usually holds more than fits; choosing is the job. Aim for the original counts, never exceed the caps - anything past a cap is cut from the end, so put the strongest material first. Overshooting changes the page count, which changes the layout.

## Selection principles

- Rank by evidence, not by recency alone. A two-year-old project that directly matches the job's core stack outranks a recent unrelated one.
- Within a section, lead with the strongest match. Chronological order is the tiebreaker, not the primary key.
- For each selected entry, pick the bullets that speak to this job. Drop bullets about unrelated work. Keep at least one bullet per entry - a heading with no content looks broken.
- Skills: reorder so the job's named technologies come first, and drop skills that would dilute the match. Never add a skill that is not already in the library.
- Education is usually fixed. Only reorder it if the job specifically calls for a qualification.
- Be honest in the gaps list. Requirements the library genuinely cannot evidence belong there, not quietly ignored.

## Scoring

matchScore is your estimate of how well this library covers the job: 90+ means nearly every requirement has direct evidence, 50 means half the requirements are uncovered, below 30 means this is a poor fit.`;

export function tailorUserPrompt(
  library: CareerLibrary,
  design: DesignSpec,
  jobDescription: string,
): string {
  const counts = design.sections
    .map((s) => {
      const b = sectionBaseline(s, library);
      const lim = sectionLimits(s, library);
      if (s.type === 'summary') return `- ${s.title} (${s.id}, summary)`;
      if (s.type === 'skills') {
        const available = library.skillGroups
          .filter((g) => g.sectionId === s.id && !g.archived)
          .reduce((n, g) => n + g.skills.length, 0);
        return `- ${s.title} (${s.id}, skills): original CV showed ${b.skills} skills; library has ${available}. Hard cap: ${lim.skills} skills in total.`;
      }
      const available = library.entries.filter((e) => e.sectionId === s.id && !e.archived).length;
      return `- ${s.title} (${s.id}, ${s.type}): original CV showed ${b.entries} entries with at most ${b.maxBullets} bullets each; library has ${available} to choose from. Hard caps: ${lim.entries} entries, ${lim.bullets} bullets per entry.`;
    })
    .join('\n');

  const libraryJson = JSON.stringify(
    {
      summaryVariants: library.summaryVariants.map((v) => ({
        id: v.id,
        label: v.label,
        text: v.text,
      })),
      entries: library.entries
        .filter((e) => !e.archived)
        .map((e) => ({
          id: e.id,
          sectionId: e.sectionId,
          title: e.title,
          subtitle: e.subtitle,
          dateText: e.dateText,
          tags: e.tags,
          bullets: e.bullets.map((b) => ({ id: b.id, text: b.text, tags: b.tags })),
        })),
      skillGroups: library.skillGroups
        .filter((g) => !g.archived)
        .map((g) => ({ id: g.id, sectionId: g.sectionId, category: g.category, skills: g.skills })),
    },
    null,
    1,
  );

  return `## Sections on this CV (fixed order, do not change)

${counts}

## Career Library

\`\`\`json
${libraryJson}
\`\`\`

## Job description

\`\`\`
${jobDescription}
\`\`\`

Select the components that make the strongest honest case for this job. Return a plan for every section listed above, even if a section's selection is unchanged.`;
}
