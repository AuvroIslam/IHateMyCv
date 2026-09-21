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
  }),
  color: z.object({
    text: hexColor,
    heading: hexColor,
    accent: hexColor,
    muted: hexColor,
    rule: hexColor,
  }),
  header: z.object({
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
    layout: z.enum(['title-left-date-right', 'title-then-subtitle', 'compact']),
    bulletChar: z.string().describe('Exact bullet glyph used by the original CV'),
    bulletIndentPt: z.number(),
    bulletSizePt: z.number(),
    bulletSpacingPt: z.number(),
    spacingPt: z.number().describe('Vertical gap between consecutive entries'),
  }),
  skills: z.object({
    layout: z.enum(['inline-categories', 'bullets', 'comma-list', 'pills']),
    categoryWeight: z.number(),
    separator: z.string().describe('Separator between individual skills, e.g. ", "'),
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
        href: z.string().nullable(),
      }),
    ),
  }),
  summary: z.string().nullable().describe('Professional summary / objective text, verbatim'),
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
      link: z.string().nullable(),
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
      skills: z.array(z.string()),
    }),
  ),
  pageCount: z.number(),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;

export const importSchema = z.object({
  entries: z
    .array(
      z.object({
        title: z.string().describe('Job title, project name, degree, or award name'),
        subtitle: z.string().nullable().describe('Company, institution, tech stack, or issuer'),
        location: z.string().nullable(),
        dateText: z
          .string()
          .nullable()
          .describe('Date range in the same format the existing entries use; null if unknown'),
        sortDate: z.string().nullable().describe('End date as YYYY-MM; "9999-12" if ongoing'),
        link: z.string().nullable(),
        bullets: z.array(bulletSchema),
        tags: z.array(z.string()).describe('5-12 lowercase keywords describing this entry'),
      }),
    )
    .describe('Entries described in the notes. Empty when the target is a skills section.'),
  skills: z
    .array(
      z.object({
        category: z
          .string()
          .describe('An existing category name if one fits, otherwise a new short label'),
        skills: z.array(z.string()),
      }),
    )
    .describe('Skills to add. Empty unless the target is a skills section.'),
});

export type ImportResult = z.infer<typeof importSchema>;

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
      evidence: z.string().nullable().describe('Which entry or bullet covers it'),
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
