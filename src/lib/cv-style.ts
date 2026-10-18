import { FONT_KEYS, fontChoice } from '@/lib/fonts';
import type { CssColor, CvDocumentData, CvStyle, DesignSpec } from '@/types/cv';

/**
 * A CV's own look (CvStyle) over the shared design: colours, and a set of
 * design properties the chat may change (DESIGN_PROPS). Whatever the design
 * already has a place for is written into a copy of the design; entry titles
 * and per-section colours, which it has no place for, become a stylesheet
 * scoped to the CV's preview, aimed at the roles CvDocument tags its
 * elements with.
 */

/** #rgb, #rrggbb, or a plain colour name: nothing that could break out of a CSS value. */
export const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]{3,20})$/i;
const SECTION_ID = /^[\w-]{1,64}$/;

const ok = (c: CssColor | undefined): c is CssColor => typeof c === 'string' && COLOR.test(c);

type Prop =
  | { kind: 'number'; label: string; min: number; max: number; unit: string }
  | { kind: 'choice'; label: string; options: readonly (string | number)[] }
  | { kind: 'font'; label: string };

/**
 * What the chat may change about a CV's design, by path into DesignSpec.
 * Ranges keep a CV readable; "margins" sets all four page margins at once.
 */
export const DESIGN_PROPS = {
  'font.bodyFamily': { kind: 'font', label: 'body font' },
  'font.headingFamily': { kind: 'font', label: 'heading font' },
  'font.baseSizePt': { kind: 'number', label: 'text size', min: 7, max: 14, unit: 'pt' },
  'font.lineHeight': { kind: 'number', label: 'line spacing', min: 1, max: 2, unit: '' },
  'font.textAlign': { kind: 'choice', label: 'text alignment', options: ['left', 'justify'] },
  'header.align': { kind: 'choice', label: 'header alignment', options: ['left', 'center'] },
  'header.nameSizePt': { kind: 'number', label: 'name size', min: 12, max: 44, unit: 'pt' },
  'header.nameWeight': { kind: 'choice', label: 'name weight', options: [400, 700] },
  'header.nameTransform': { kind: 'choice', label: 'name case', options: ['none', 'uppercase'] },
  'sectionHeading.sizePt': { kind: 'number', label: 'section heading size', min: 8, max: 22, unit: 'pt' },
  'sectionHeading.weight': { kind: 'choice', label: 'section heading weight', options: [400, 700] },
  'sectionHeading.transform': { kind: 'choice', label: 'section heading case', options: ['none', 'uppercase', 'capitalize'] },
  'sectionHeading.style': {
    kind: 'choice',
    label: 'section heading style',
    options: ['plain', 'underline', 'rule-after', 'rule-before', 'filled-bar'],
  },
  'sectionHeading.align': { kind: 'choice', label: 'section heading alignment', options: ['left', 'center'] },
  'sectionHeading.spaceBeforePt': { kind: 'number', label: 'space above section headings', min: 0, max: 30, unit: 'pt' },
  'sectionHeading.spaceAfterPt': { kind: 'number', label: 'space below section headings', min: 0, max: 20, unit: 'pt' },
  'entry.titleSizePt': { kind: 'number', label: 'entry title size', min: 8, max: 18, unit: 'pt' },
  'entry.titleWeight': { kind: 'choice', label: 'entry title weight', options: [400, 700] },
  'entry.subtitleStyle': { kind: 'choice', label: 'subtitle style', options: ['normal', 'italic', 'bold'] },
  'entry.dateStyle': { kind: 'choice', label: 'date style', options: ['normal', 'italic'] },
  'entry.spacingPt': { kind: 'number', label: 'space between entries', min: 0, max: 24, unit: 'pt' },
  'entry.bulletChar': { kind: 'choice', label: 'bullet', options: ['•', '–', '▪', '◦', '›', '✓', '★'] },
  'entry.bulletSpacingPt': { kind: 'number', label: 'space between bullets', min: 0, max: 10, unit: 'pt' },
  margins: { kind: 'number', label: 'page margins', min: 6, max: 30, unit: 'mm' },
} as const satisfies Record<string, Prop>;

export type DesignProp = keyof typeof DESIGN_PROPS;
export const DESIGN_PROP_KEYS = Object.keys(DESIGN_PROPS) as [DesignProp, ...DesignProp[]];

/** A property's value if it is one the property allows (numbers clamped to range), else null. */
export function validProp(prop: DesignProp, value: unknown): string | number | null {
  const def: Prop = DESIGN_PROPS[prop];
  if (def.kind === 'font') return typeof value === 'string' && FONT_KEYS.includes(value) ? value : null;
  if (def.kind === 'choice') return def.options.find((o) => String(o) === String(value).trim()) ?? null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[a-z\s]+$/i, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(def.max, Math.max(def.min, n)) * 100) / 100;
}

/** A value as the user would say it. */
export function describeProp(prop: DesignProp, value: string | number): string {
  const def: Prop = DESIGN_PROPS[prop];
  if (def.kind === 'font') return fontChoice(String(value)).label;
  if (def.kind === 'number') return `${value}${def.unit}`;
  if (prop.endsWith('Weight')) return Number(value) >= 600 ? 'bold' : 'regular';
  return String(value);
}

const designProps = (style: CvStyle | undefined) =>
  Object.entries(style?.design ?? {}).flatMap(([k, v]) => {
    if (!(k in DESIGN_PROPS)) return [];
    const value = validProp(k as DesignProp, v);
    return value === null ? [] : [[k as DesignProp, value] as const];
  });

export function hasStyle(style: CvStyle | undefined): boolean {
  if (!style) return false;
  const colors = Object.values(style.colors ?? {}).some(ok);
  const sections = Object.values(style.sections ?? {}).some((s) => Object.values(s ?? {}).some(ok));
  return colors || sections || designProps(style).length > 0;
}

/** The design with this CV's own look in place. Returns the design itself when nothing differs. */
export function styledDesign(design: DesignSpec, style: CvStyle | undefined): DesignSpec {
  const c = style?.colors ?? {};
  const props = designProps(style);
  if (!style?.colors && !props.length) return design;
  const pick = (v: CssColor | undefined, fallback: string) => (ok(v) ? v : fallback);
  const next: DesignSpec = structuredClone({
    ...design,
    color: {
      ...design.color,
      text: pick(c.text, design.color.text),
      link: pick(c.links, design.color.link),
      rule: pick(c.rules, design.color.rule),
      accent: pick(c.accent, design.color.accent),
    },
    header: { ...design.header, nameColor: pick(c.name, design.header.nameColor) },
    sectionHeading: { ...design.sectionHeading, color: pick(c.headings, design.sectionHeading.color) },
  });
  for (const [prop, value] of props) {
    if (prop === 'margins') {
      const mm = Number(value);
      Object.assign(next.page, { marginTop: mm, marginRight: mm, marginBottom: mm, marginLeft: mm });
      continue;
    }
    const [group, key] = prop.split('.') as [keyof DesignSpec, string];
    (next[group] as unknown as Record<string, unknown>)[key] = value;
    // A chosen font replaces the original's own faces for that role, which
    // would otherwise still come first in its font stack.
    if (prop === 'font.bodyFamily') next.font.embedded = next.font.embedded.filter((f) => f.role !== 'body');
    if (prop === 'font.headingFamily') next.font.embedded = next.font.embedded.filter((f) => f.role === 'body');
  }
  return JSON.stringify(next) === JSON.stringify(design) ? design : next;
}

/** The stylesheet for what the design cannot hold, scoped to one preview. */
export function styleCss(style: CvStyle | undefined, scope: string): string {
  if (!style) return '';
  const root = `[data-cv-root="${scope.replace(/[^\w-]/g, '')}"]`;
  const rules: string[] = [];
  if (ok(style.colors?.titles)) rules.push(`${root} [data-role="entry-title"] { color: ${style.colors.titles}; }`);
  for (const [id, s] of Object.entries(style.sections ?? {})) {
    if (!SECTION_ID.test(id) || !s) continue;
    const sec = `${root} [data-section="${id}"]`;
    if (ok(s.text)) rules.push(`${sec} { color: ${s.text}; }`);
    if (ok(s.headings)) rules.push(`${sec} [data-role="heading"] { color: ${s.headings}; }`);
    if (ok(s.titles)) rules.push(`${sec} [data-role="entry-title"] { color: ${s.titles}; }`);
  }
  return rules.join('\n');
}

/**
 * What a block's colours depend on: blocks that differ here print
 * differently. Per kind of block, so recolouring entry titles leaves the
 * section's heading as it was.
 */
export function blockLook(
  design: DesignSpec,
  style: CvStyle | undefined,
  block: { key: string; section?: string },
): string {
  const c = design.color;
  const own = (block.section && style?.sections?.[block.section]) || {};
  // Design changes, as far as they reach this kind of block: page margins and
  // fonts reach every block.
  const area = block.key === 'header' ? 'header.' : block.key.endsWith(':heading') ? 'sectionHeading.' : 'entry.';
  const props = designProps(style).filter(([k]) => k === 'margins' || k.startsWith('font.') || k.startsWith(area));
  if (props.length) return JSON.stringify([c, design.header.nameColor, design.sectionHeading.color, props]);
  if (block.key === 'header') return JSON.stringify([c.text, c.muted, c.link, c.rule, design.header.nameColor]);
  if (block.key.endsWith(':heading')) return JSON.stringify([design.sectionHeading.color, c.rule, c.accent, own.headings ?? null]);
  return JSON.stringify([c.text, c.muted, c.link, c.rule, c.accent, style?.colors?.titles ?? null, own.titles ?? null, own.text ?? null]);
}

/**
 * The CV with its original line breaks unlocked once its font or margins
 * change: the breaks were the original's, set in its font at its width, and
 * held to them other text would overflow or squeeze its spaces away.
 */
export function freeLines(data: CvDocumentData): CvDocumentData {
  if (!designProps(data.style).some(([k]) => k === 'margins' || k.startsWith('font.'))) return data;
  return {
    ...data,
    sections: data.sections.map((s) => ({
      ...s,
      summaryLines: undefined,
      summaryParagraphs: undefined,
      entries: s.entries.map((e) => ({
        ...e,
        bulletPrint: e.bulletPrint
          ? Object.fromEntries(Object.entries(e.bulletPrint).map(([k, v]) => [k, { ...v, lines: undefined }]))
          : undefined,
      })),
    })),
  };
}
