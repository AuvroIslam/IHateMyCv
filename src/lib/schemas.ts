import { z } from 'zod';
import { FONT_KEYS } from './fonts';

// Structured outputs run in strict mode: every property must be present, so
// "absent" is modelled as `.nullable()` rather than `.optional()`.

const hexColor = z.string().describe('CSS colour, e.g. "#1a1a1a"');

export const sectionTypeSchema = z.enum([
  'summary',
  'education',
  'experience',
  'projects',
  'skills',
  'achievements',
  'extra',
]);

export const designSpecSchema = z.object({
  page: z.object({
    size: z.enum(['a4', 'letter']),
    marginTop: z.number().describe('Top margin in millimetres'),
    marginRight: z.number(),
    marginBottom: z.number(),
    marginLeft: z.number(),
  }),
  font: z.object({
    bodyFamily: z
      .enum(FONT_KEYS)
      .describe('Font key from the catalogue that best matches the original body text'),
    headingFamily: z
      .enum(FONT_KEYS)
      .describe('Font key for the name and section headings; usually the same as bodyFamily'),
    baseSizePt: z.number().describe('Body text size in points, typically 9-11.5'),
    lineHeight: z.number().describe('Unitless line-height, typically 1.15-1.45'),
    textAlign: z
      .enum(['left', 'justify'])
      .describe(
        'justify when wrapped summary/bullet lines end flush at the right margin (typical of LaTeX, often with hyphenated words); left when their right edge is ragged',
      ),
  }),
  color: z.object({
    text: hexColor,
    heading: hexColor,
    accent: hexColor,
    muted: hexColor,
    rule: hexColor,
    link: hexColor.describe('Colour of clickable text (links, email). Same as text if links are not coloured'),
  }),
  header: z.object({
    contactTopPt: z.number().describe('Gap between the name and the contact line, in points'),
    contactGapPt: z
      .number()
      .nullable()
      .describe('Horizontal space on each side of the contact separator glyph, in points, from the SEPARATOR GAPS list; null if there is no separator'),
    contactOrder: z
      .array(z.enum(['phone', 'email', 'location', 'links']))
      .describe('Order the contact items appear in, left to right. "links" is where the personal links go'),
    contactLabels: z
      .object({ phone: z.string(), email: z.string(), location: z.string() })
      .describe('Label text printed before each value exactly as shown, e.g. "Phone:". Empty string when there is none'),
    contactLabelWeight: z.number().describe('Font weight of those labels, 400 or 700'),
    align: z.enum(['left', 'center']),
    nameSizePt: z.number(),
    nameWeight: z.number().describe('CSS font-weight, 400/600/700'),
    nameTransform: z.enum(['none', 'uppercase']),
    nameLetterSpacingEm: z.number(),
    nameColor: hexColor,
    headlineShown: z.boolean(),
    headlineSizePt: z.number(),
    headlineStyle: z.enum(['normal', 'italic']),
    contactSizePt: z.number(),
    contactSeparator: z
      .string()
      .describe('Exact glyph(s) between contact items, including surrounding spaces'),
    contactLayout: z.enum(['inline', 'stacked', 'two-line']),
    ruleBelow: z.boolean(),
    spaceBelowPt: z.number(),
  }),
  sectionHeading: z.object({
    sizePt: z.number(),
    weight: z.number(),
    transform: z.enum(['none', 'uppercase', 'capitalize']),
    letterSpacingEm: z.number(),
    align: z.enum(['left', 'center']),
    style: z
      .enum(['plain', 'underline', 'rule-after', 'filled-bar'])
      .describe(
        'underline = rule directly under the text only; rule-after = full-width rule below the heading; filled-bar = solid background band',
      ),
    color: hexColor,
    spaceBeforePt: z.number(),
    spaceAfterPt: z.number(),
    rulePt: z.number().describe('Rule thickness in points; 0 when there is no rule'),
  }),
  entry: z.object({
    titleSizePt: z.number(),
    titleWeight: z.number(),
    subtitleStyle: z.enum(['normal', 'italic', 'bold']),
    subtitleSizePt: z.number(),
    dateAlign: z.enum(['right', 'inline']),
    dateStyle: z.enum(['normal', 'italic']),
    dateSizePt: z.number(),
    layout: z
      .enum(['title-left-date-right', 'title-then-subtitle', 'compact', 'org-title', 'title-org'])
      .describe(
        'org-title = "Company – Role" printed as ONE line in the title style with the date right and the location alone on the next line (store company in subtitle, role in title)',
      ),
    titleJoiner: z.string().describe('For org-title: exact text between company and role, e.g. " – "'),
    subtitleGapPt: z.number().describe('Extra gap between the title row and the row below, beyond line spacing; usually 0'),
    bulletsTopPt: z.number().describe('Extra gap between an entry heading and its first bullet; usually 0-3'),
    bulletChar: z.string().describe('Exact bullet glyph used by the original CV'),
    bulletIndentPt: z
      .number()
      .describe('Distance from the left margin to the bullet glyph, in points (glyph x minus margin x)'),
    bulletTextIndentPt: z
      .number()
      .describe('Distance from the left margin to where bullet text starts, in points (text x minus margin x)'),
    bulletSizePt: z.number(),
    bulletSpacingPt: z
      .number()
      .describe('Extra gap between consecutive bullets beyond normal line spacing; 0 when bullets are set solid'),
    spacingPt: z.number().describe('Vertical gap between consecutive entries'),
    linksPlacement: z
      .enum(['bullet', 'title-line', 'own-line'])
      .describe(
        'Where entry links are printed: bullet = as a final bullet row under the entry; title-line = after the title on the same line; own-line = on an unbulleted line under the heading. Use bullet if no entry has links',
      ),
    linkSeparator: z.string().describe('Exact text between two links of one entry, spaces included'),
    linkGapPt: z
      .number()
      .nullable()
      .describe('Horizontal space on each side of the separator between entry links, from SEPARATOR GAPS; null if none'),
    groupLabel: z
      .object({
        weight: z.number(),
        underline: z.boolean(),
        sizePt: z.number(),
        spaceBeforePt: z.number(),
        spaceAfterPt: z.number(),
      })
      .describe('Style of sub-headings inside a section (e.g. "National"), if any; otherwise any sensible values'),
  }),
  skills: z.object({
    layout: z
      .enum(['inline-categories', 'bullets', 'comma-list', 'pills', 'columns'])
      .describe(
        'columns = categories laid out in a grid of N columns, each category label on its own line followed by its items',
      ),
    categoryWeight: z.number(),
    separator: z.string().describe('Separator between individual skills, e.g. ", "'),
    lineGapPt: z.number().describe('Extra gap between skill lines or grid rows; usually 0-3'),
    columns: z.number().describe('Number of columns for the columns layout; 1 otherwise'),
    columnGapPt: z.number().describe('Gap between columns in points'),
  }),
  layout: z.object({
    type: z.enum(['single', 'two-column']),
    sideColumn: z.enum(['left', 'right']),
    sideWidthPct: z.number(),
  }),
  sections: z
    .array(
      z.object({
        id: z.string().describe('Lowercase slug, unique, e.g. "work-experience"'),
        title: z.string().describe('Heading text copied EXACTLY as printed, including case'),
        type: sectionTypeSchema,
        column: z.enum(['main', 'side']),
      }),
    )
    .describe('Every section, in the exact top-to-bottom order of the original CV'),
});

const entryLinksSchema = z
  .array(z.object({ label: z.string().describe('Link text as printed'), url: z.string() }))
  .describe('Labelled links for this entry, e.g. Github / Live Link, with URLs from the LINKS list');

const bulletSchema = z.object({
  text: z.string(),
  tags: z.array(z.string()).describe('3-8 lowercase skill/domain keywords this bullet evidences'),
});

export const extractionSchema = z.object({
  design: designSpecSchema,
  personal: z.object({
    fullName: z.string(),
    headline: z.string().nullable().describe('Role line under the name, if present'),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    links: z.array(
      z.object({
        label: z.string().describe('Display text as printed, e.g. "github.com/jane"'),
        value: z.string(),
        href: z.string().nullable().describe('Target URL from the LINKS list; null only if none exists'),
      }),
    ),
  }),
  summary: z
    .string()
    .nullable()
    .describe('The whole professional summary / objective, verbatim - every paragraph, separated by a blank line'),
  entries: z.array(
    z.object({
      sectionId: z.string().describe('Must match one design.sections[].id'),
      title: z.string().describe('Job title, project name, degree, or award name'),
      subtitle: z
        .string()
        .nullable()
        .describe('Company, institution, tech stack, or issuer - as printed'),
      location: z.string().nullable(),
      dateText: z.string().nullable().describe('Date range copied EXACTLY as printed'),
      sortDate: z
        .string()
        .nullable()
        .describe('End date as YYYY-MM for sorting; "9999-12" if ongoing/present'),
      link: z.string().nullable().describe('URL the title itself links to, if the title is clickable'),
      links: entryLinksSchema,
      group: z
        .string()
        .nullable()
        .describe('Sub-heading this entry is printed under inside its section (e.g. "National"), verbatim; null if none'),
      bullets: z.array(bulletSchema),
      tags: z.array(z.string()).describe('5-12 lowercase keywords describing this entry'),
    }),
  ),
  skillGroups: z.array(
    z.object({
      sectionId: z.string(),
      category: z
        .string()
        .describe('Category label as printed, e.g. "Languages". Empty string if ungrouped'),
      skills: z
        .array(z.string())
        .describe('Items as printed. When a category is a bulleted list, each bullet line is one item, verbatim'),
      list: z.boolean().describe('True when this category prints its items as bullets rather than one line'),
    }),
  ),
  pageCount: z.number(),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;

// ---------------------------------------------------------------------------
// Upload runs as two calls in parallel plus one in the background. Their
// outputs merge into ExtractionResult above.

/** Look only: measured from page images and coordinates. Sections come from the content call. */
export const designCaptureSchema = z.object({
  design: designSpecSchema.omit({ sections: true }),
});
export type DesignCapture = z.infer<typeof designCaptureSchema>;

/**
 * The same capture in two halves, read in parallel. Claude's structured
 * output compiles each schema into a grammar, and the whole design schema is
 * past its size limit; each half is well inside it.
 */
export const designPageSchema = z.object({
  design: designSpecSchema.pick({ page: true, font: true, color: true, header: true }),
});
export const designBodySchema = z.object({
  design: designSpecSchema.pick({ sectionHeading: true, entry: true, skills: true, layout: true }),
});

const contentShape = extractionSchema.shape;

/** Words only: verbatim content and structure, no keywords. */
export const contentSchema = z.object({
  sections: designSpecSchema.shape.sections,
  personal: contentShape.personal,
  summary: contentShape.summary,
  entries: z.array(
    z.object({
      sectionId: z.string().describe('Must match one sections[].id'),
      title: z
        .string()
        .describe('The role, degree, project name or award - whichever way round the CV prints it. Empty for a headingless list of bullets'),
      subtitle: z
        .string()
        .nullable()
        .describe('The organisation (company, institution, issuer) or tech stack'),
      location: z.string().nullable(),
      dateText: z.string().nullable().describe('Date range copied EXACTLY as printed'),
      sortDate: z.string().nullable().describe('End date as YYYY-MM for sorting; "9999-12" if ongoing/present'),
      link: z.string().nullable().describe('URL the title itself links to, if the title is clickable'),
      links: entryLinksSchema,
      group: z
        .string()
        .nullable()
        .describe('Sub-heading this entry is printed under inside its section (e.g. "National"), verbatim; null if none'),
      bullets: z.array(z.string()).describe('Bullet text, verbatim'),
    }),
  ),
  skillGroups: contentShape.skillGroups,
  pageCount: z.number(),
});
export type ContentCapture = z.infer<typeof contentSchema>;

/** Matching keywords, generated after the upload has already returned. */
export const tagsSchema = z.object({
  entries: z.array(
    z.object({
      index: z.number().describe('Index of the entry in the list given'),
      tags: z.array(z.string()).describe('5-12 lowercase keywords describing the entry'),
      bulletTags: z
        .array(z.array(z.string()))
        .describe('One list of 3-8 lowercase keywords per bullet, in bullet order'),
    }),
  ),
});
export type TagsResult = z.infer<typeof tagsSchema>;

export const tailorSchema = z.object({
  roleTitle: z.string().nullable(),
  company: z.string().nullable(),
  matchScore: z.number().describe('0-100 estimate of how well the library covers this job'),
  headline: z
    .string()
    .nullable()
    .describe('Replacement headline under the name. Null keeps the original.'),
  summaryId: z
    .string()
    .nullable()
    .describe('id of the summary variant to use, or null for the default'),
  keywords: z.array(
    z.object({
      keyword: z.string(),
      covered: z.boolean(),
      evidence: z.string().nullable().describe('Which entry or bullet covers it, in words a reader understands ("PulseBand: Firebase offline sync"); never ids'),
    }),
  ),
  sections: z.array(
    z.object({
      sectionId: z.string(),
      entryIds: z
        .array(z.string())
        .describe('Chosen library entry ids, in the order they should appear'),
      skillGroups: z.array(
        z.object({
          groupId: z.string(),
          skills: z.array(z.string()).describe('Chosen skills from that group, reordered'),
        }),
      ),
    }),
  ),
  bulletSelection: z
    .array(
      z.object({
        entryId: z.string(),
        bulletIds: z.array(z.string()).describe('Chosen bullet ids, in display order'),
      }),
    )
    .describe('Which bullets to keep for each selected entry'),
  gaps: z.array(z.string()).describe('Job requirements the library cannot evidence'),
  rationale: z.string().describe('2-4 sentences on why these components were chosen'),
});

export type TailorResult = z.infer<typeof tailorSchema>;

/** A CV read into My Info: everything about the person, not how the page was laid out. */
export const profileImportSchema = z.object({
  personal: contentShape.personal,
  summary: z.string().nullable().describe('The summary or profile paragraph(s), verbatim; null if none'),
  about: z
    .array(z.string())
    .describe(
      'One line per fact that is not a job, project, achievement, degree or skill: languages, certifications, volunteering, interests, publications, availability. Keep the wording of the CV, prefixed with what it is, e.g. "Languages: Bangla (native), English (fluent)".',
    ),
  entries: z.array(
    z.object({
      kind: z.enum(['experience', 'projects', 'achievements', 'education']),
      title: z.string().describe('The role, project name, award or degree'),
      subtitle: z.string().nullable().describe('The organisation (company, institution, issuer) or tech stack'),
      location: z.string().nullable(),
      dateText: z.string().nullable().describe('Dates copied exactly as printed'),
      link: z.string().nullable().describe('URL the title itself links to, if any'),
      links: entryLinksSchema,
      bullets: z.array(z.string()).describe('Bullet text and detail lines, verbatim'),
    }),
  ),
  skills: z.array(z.object({ category: z.string().describe('"" if the CV gives none'), skills: z.array(z.string()) })),
});
export type ProfileImport = z.infer<typeof profileImportSchema>;
