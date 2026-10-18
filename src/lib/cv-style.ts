import type { CssColor, CvStyle, DesignSpec } from '@/types/cv';

/**
 * A CV's own colours (CvStyle) over the shared design. Whole-CV colours the
 * design already has a place for are written into a copy of the design;
 * entry titles and per-section colours, which it has no place for, become a
 * stylesheet scoped to the CV's preview, aimed at the roles CvDocument tags
 * its elements with.
 */

/** #rgb, #rrggbb, or a plain colour name: nothing that could break out of a CSS value. */
export const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]{3,20})$/i;
const SECTION_ID = /^[\w-]{1,64}$/;

const ok = (c: CssColor | undefined): c is CssColor => typeof c === 'string' && COLOR.test(c);

export function hasStyle(style: CvStyle | undefined): boolean {
  if (!style) return false;
  const colors = Object.values(style.colors ?? {}).some(ok);
  const sections = Object.values(style.sections ?? {}).some((s) => Object.values(s ?? {}).some(ok));
  return colors || sections;
}

/** The design with this CV's whole-CV colours in place. Returns the design itself when there are none. */
export function styledDesign(design: DesignSpec, style: CvStyle | undefined): DesignSpec {
  const c = style?.colors;
  if (!c) return design;
  const pick = (v: CssColor | undefined, fallback: string) => (ok(v) ? v : fallback);
  const next: DesignSpec = {
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
  };
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
  if (block.key === 'header') return JSON.stringify([c.text, c.muted, c.link, c.rule, design.header.nameColor]);
  if (block.key.endsWith(':heading')) return JSON.stringify([design.sectionHeading.color, c.rule, c.accent, own.headings ?? null]);
  return JSON.stringify([c.text, c.muted, c.link, c.rule, c.accent, style?.colors?.titles ?? null, own.titles ?? null, own.text ?? null]);
}
