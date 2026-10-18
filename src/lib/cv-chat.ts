import { z } from 'zod';
import { COLOR, DESIGN_PROPS, DESIGN_PROP_KEYS, type DesignProp, describeProp, styledDesign, validProp } from '@/lib/cv-style';
import { FONT_KEYS } from '@/lib/fonts';
import type {
  CareerLibrary,
  ChatTurn,
  CvDocumentData,
  CvStyle,
  DesignSpec,
  RenderedEntry,
  RenderedSection,
  RenderedSkillGroup,
} from '@/types/cv';

/**
 * Chat editing: the model changes a CV through a small set of edit tools,
 * each naming its target by a short reference (E3 = an entry, E3.2 = its
 * second bullet, G1 = a skill group) from a plain-text view of the CV. Edits
 * are applied and validated here, one at a time, so the preview can show
 * each as it lands and a bad reference is reported back instead of applied.
 */

export type { ChatTurn };

type Target =
  | { kind: 'entry'; entry: RenderedEntry }
  | { kind: 'bullet'; entry: RenderedEntry; text: string; index: number }
  | { kind: 'group'; group: RenderedSkillGroup };

export interface DocView {
  text: string;
  refs: Map<string, Target>;
}

const sectionTitle = (s: RenderedSection, design: DesignSpec) =>
  s.title ?? design.sections.find((d) => d.id === s.sectionId)?.title ?? s.sectionId;
const sectionType = (s: RenderedSection, design: DesignSpec) =>
  design.sections.find((d) => d.id === s.sectionId)?.type ?? 'extra';

/** The CV as the model reads it, with a reference for everything it can edit. */
export function viewDoc(
  data: CvDocumentData,
  design: DesignSpec,
  library: CareerLibrary | null,
  /** True facts from the owner's Profile that are not entries (see withProfile). */
  facts = '',
): DocView {
  const refs = new Map<string, Target>();
  const out: string[] = [];
  const p = data.personal;
  out.push('HEADER');
  out.push(`  name: ${p.fullName}`);
  out.push(`  headline: ${p.headline || '(none)'}`);
  for (const [k, v] of [
    ['email', p.email],
    ['phone', p.phone],
    ['location', p.location],
  ] as const) {
    if (v) out.push(`  ${k}: ${v}`);
  }

  let e = 0;
  let g = 0;
  const onCv = new Set<string>();
  for (const s of data.sections) {
    if (s.hidden) continue;
    const type = sectionType(s, design);
    out.push('');
    out.push(`SECTION "${sectionTitle(s, design)}" (section id: ${s.sectionId}, ${type})`);
    if (type === 'summary') out.push(`  summary: ${s.summary?.trim() || '(empty)'}`);
    for (const entry of s.entries) {
      const ref = `E${++e}`;
      refs.set(ref, { kind: 'entry', entry });
      if (entry.entryId) onCv.add(entry.entryId);
      const head = [entry.title || '(no title)', entry.subtitle, entry.dateText, entry.location].filter(Boolean).join(' | ');
      out.push(`  [${ref}] ${head}${entry.group ? `  (group: ${entry.group})` : ''}`);
      entry.bullets.forEach((text, i) => {
        refs.set(`${ref}.${i + 1}`, { kind: 'bullet', entry, text, index: i });
        out.push(`    [${ref}.${i + 1}] ${text}`);
      });
    }
    for (const group of s.skillGroups) {
      const ref = `G${++g}`;
      refs.set(ref, { kind: 'group', group });
      out.push(`  [${ref}] ${group.category ? `${group.category}: ` : ''}${group.skills.join(', ')}`);
    }
  }

  const look = styledDesign(design, data.style);
  const c = data.style?.colors;
  out.push('');
  out.push("STYLE (this CV's colours; set_style changes them for this CV only)");
  out.push(
    `  name ${look.header.nameColor}, headings ${look.sectionHeading.color}, titles ${c?.titles ?? `(as text)`}, text ${look.color.text}, links ${look.color.link}, rules ${look.color.rule}, accent ${look.color.accent}`,
  );
  for (const [id, sc] of Object.entries(data.style?.sections ?? {})) {
    const set = Object.entries(sc ?? {}).map(([k, v]) => `${k} ${v}`);
    if (set.length) out.push(`  section ${id}: ${set.join(', ')}`);
  }
  out.push("DESIGN (set_design changes these for this CV only; current values)");
  const current = (prop: DesignProp): string | number => {
    if (prop === 'margins') return `${look.page.marginTop}/${look.page.marginRight}/${look.page.marginBottom}/${look.page.marginLeft}`;
    const [group, key] = prop.split('.') as [keyof DesignSpec, string];
    return (look[group] as unknown as Record<string, string | number>)[key];
  };
  out.push(`  ${DESIGN_PROP_KEYS.map((k) => `${k}=${current(k)}`).join(', ')}`);

  if (facts.trim()) {
    out.push('');
    out.push("MORE ABOUT THE OWNER (true facts from their Profile; use them when asked, e.g. to add languages or rewrite the summary):");
    out.push(facts.trim().split('\n').map((l) => `  ${l}`).join('\n'));
  }

  const spare = (library?.entries ?? []).filter((x) => !x.archived && !onCv.has(x.id));
  if (spare.length) {
    out.push('');
    out.push('CAREER LIBRARY AND PROFILE ENTRIES NOT ON THIS CV (add_library_entry brings one in, with its own bullets):');
    for (const x of spare) {
      const first = x.bullets[0]?.text;
      out.push(
        `  - library id ${x.id}: "${x.title || '(list)'}"${x.subtitle ? ` / ${x.subtitle}` : ''} - section ${x.sectionId}, ${x.bullets.length} bullets${first ? `; e.g. "${first.slice(0, 90)}"` : ''}`,
      );
    }
  }
  return { text: out.join('\n'), refs };
}

// ---------------------------------------------------------------------------
// Tools

const position = z.number().int().min(1).optional().describe('1-based position in its list; omit for the end');

export const EDIT_TOOLS = {
  edit_text: {
    description:
      'Replace one piece of text. target is "headline", "summary", an entry field ("E3.title", "E3.subtitle", "E3.date", "E3.location") or a bullet ("E3.2").',
    schema: z.object({ target: z.string(), text: z.string() }),
  },
  add_bullet: {
    description: 'Add a bullet to an entry.',
    schema: z.object({ entry: z.string().describe('Entry reference, e.g. "E3"'), text: z.string(), position }),
  },
  remove: {
    description: 'Remove an entry ("E3"), a bullet ("E3.2") or a skill group ("G1") from this CV. Library entries stay in the library.',
    schema: z.object({ target: z.string() }),
  },
  move: {
    description: 'Move an entry, bullet or skill group to a new position within its own list.',
    schema: z.object({ target: z.string(), position: z.number().int().min(1) }),
  },
  set_skills: {
    description: 'Replace the skills of a group (reorder, drop, or add skills the user has).',
    schema: z.object({ group: z.string().describe('e.g. "G1"'), skills: z.array(z.string()) }),
  },
  add_library_entry: {
    description: 'Put a Career Library entry that is not on this CV back onto it, in its section.',
    schema: z.object({ libraryId: z.string(), position }),
  },
  add_entry: {
    description: 'Add a brand-new entry from facts the user gave in the chat.',
    schema: z.object({
      sectionId: z.string(),
      title: z.string(),
      subtitle: z.string().optional(),
      date: z.string().optional(),
      location: z.string().optional(),
      bullets: z.array(z.string()),
      position,
    }),
  },
  set_style: {
    description:
      'Change a colour on this CV only; other CVs keep theirs. target: name, headings (section headings), titles (entry titles like a project or job name), text (body text), links, rules (divider lines), accent. section: a section id to colour only that section - headings, titles and text only; omit for the whole CV. color: a hex colour such as "#1d4ed8" (plain names like "navy" also work), or "default" to undo an earlier colour change.',
    schema: z.object({
      target: z.enum(['name', 'headings', 'titles', 'text', 'links', 'rules', 'accent']),
      section: z.string().optional(),
      color: z.string(),
    }),
  },
  set_design: {
    description: `Change the design of this CV only; other CVs keep theirs. property is one of the DESIGN properties in the view. value: a number for sizes and spacing (pt; mm for margins, which sets all four), one of the allowed options otherwise (weights 400 or 700), or "default" to undo an earlier change. Allowed options: ${DESIGN_PROP_KEYS.flatMap((k) => {
      const d = DESIGN_PROPS[k];
      return d.kind === 'choice' ? [`${k}: ${d.options.join(' | ')}`] : d.kind === 'number' ? [`${k}: ${d.min}-${d.max}${d.unit}`] : [];
    }).join('; ')}. Fonts: ${FONT_KEYS.join(', ')}.`,
    schema: z.object({
      property: z.enum(DESIGN_PROP_KEYS),
      value: z.union([z.string(), z.number()]),
    }),
  },
} as const;

export type EditName = keyof typeof EDIT_TOOLS;

const STYLE_LABEL = {
  name: 'name',
  headings: 'section headings',
  titles: 'entry titles',
  text: 'text',
  links: 'links',
  rules: 'divider lines',
  accent: 'accent colour',
} as const;

/** Tool definitions in the shape the Messages API takes. */
export function toolDefinitions() {
  return (Object.keys(EDIT_TOOLS) as EditName[]).map((name) => ({
    name,
    description: EDIT_TOOLS[name].description,
    input_schema: z.toJSONSchema(EDIT_TOOLS[name].schema) as { type: 'object'; [k: string]: unknown },
  }));
}

// ---------------------------------------------------------------------------
// Applying edits

export interface EditResult {
  ok: boolean;
  /** For the model: what happened, or why not. */
  message: string;
  /** For the user: one line describing the change. */
  change?: string;
}

const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);


function sectionOf(data: CvDocumentData, entry: RenderedEntry) {
  return data.sections.find((s) => s.entries.includes(entry));
}
function sectionOfGroup(data: CvDocumentData, group: RenderedSkillGroup) {
  return data.sections.find((s) => s.skillGroups.includes(group));
}

/** Where a referenced bullet is now: earlier edits this turn may have shifted it. */
function bulletIndex(t: Extract<Target, { kind: 'bullet' }>): number {
  const b = t.entry.bullets;
  if (b[t.index] === t.text) return t.index;
  return b.indexOf(t.text);
}

function place<T>(list: T[], item: T, pos?: number) {
  const at = pos == null ? list.length : Math.max(0, Math.min(list.length, pos - 1));
  list.splice(at, 0, item);
}

/**
 * Applies one edit to `data` in place. References resolve against the view
 * the model was shown (`refs`), so an edit still finds its target after
 * earlier edits in the same turn moved things around.
 */
export function applyEdit(
  data: CvDocumentData,
  design: DesignSpec,
  library: CareerLibrary | null,
  refs: Map<string, Target>,
  name: string,
  input: unknown,
): EditResult {
  const tool = EDIT_TOOLS[name as EditName];
  if (!tool) return { ok: false, message: `Unknown tool ${name}.` };
  // An entry as the user knows it; a list with no heading goes by its section's title.
  const label = (e: RenderedEntry) => {
    const s = sectionOf(data, e);
    return `"${short(e.title || e.subtitle || (s ? sectionTitle(s, design) : 'list'))}"`;
  };
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: `Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}` };
  const args = parsed.data as Record<string, unknown>;
  const ref = (r: unknown) => refs.get(String(r).trim().replace(/^\[|\]$/g, ''));

  switch (name as EditName) {
    case 'edit_text': {
      const { target, text } = args as { target: string; text: string };
      const value = text.trim();
      if (!value) return { ok: false, message: 'Text is empty; use remove to delete something.' };
      const unchanged: EditResult = { ok: true, message: 'It already says exactly that; nothing changed.' };
      if (target === 'headline') {
        if (data.personal.headline?.trim() === value) return unchanged;
        data.personal.headline = value;
        return { ok: true, message: 'Headline updated.', change: 'Updated the headline' };
      }
      if (target === 'summary') {
        const s = data.sections.find((x) => sectionType(x, design) === 'summary' && !x.hidden);
        if (!s) return { ok: false, message: 'This CV has no summary section.' };
        if (s.summary?.trim() === value) return unchanged;
        s.summary = value;
        return { ok: true, message: 'Summary updated.', change: 'Rewrote the summary' };
      }
      const field = target.match(/^\[?(E\d+)\]?\.(title|subtitle|date|location)$/);
      if (field) {
        const t = ref(field[1]);
        if (t?.kind !== 'entry') return { ok: false, message: `No entry ${field[1]}.` };
        const key = field[2] === 'date' ? 'dateText' : (field[2] as 'title' | 'subtitle' | 'location');
        if (t.entry[key]?.trim() === value) return unchanged;
        t.entry[key] = value;
        return { ok: true, message: `${target} updated.`, change: `Changed the ${field[2]} of ${label(t.entry)}` };
      }
      const t = ref(target);
      if (t?.kind !== 'bullet') return { ok: false, message: `No bullet ${target}.` };
      const i = bulletIndex(t);
      if (i < 0) return { ok: false, message: `${target} was already removed this turn.` };
      if (t.entry.bullets[i].trim() === value) return unchanged;
      t.entry.bullets[i] = value;
      t.text = value;
      return { ok: true, message: `${target} updated.`, change: `Rewrote a bullet in ${label(t.entry)}` };
    }

    case 'add_bullet': {
      const { entry, text, position: pos } = args as { entry: string; text: string; position?: number };
      const t = ref(entry);
      if (t?.kind !== 'entry') return { ok: false, message: `No entry ${entry}.` };
      if (!text.trim()) return { ok: false, message: 'Text is empty.' };
      place(t.entry.bullets, text.trim(), pos);
      return { ok: true, message: `Bullet added to ${entry}.`, change: `Added a bullet to ${label(t.entry)}` };
    }

    case 'remove': {
      const t = ref(args.target);
      if (!t) return { ok: false, message: `No ${String(args.target)} to remove.` };
      if (t.kind === 'bullet') {
        const i = bulletIndex(t);
        if (i < 0) return { ok: false, message: 'Already removed.' };
        t.entry.bullets.splice(i, 1);
        return { ok: true, message: 'Bullet removed.', change: `Removed a bullet from ${label(t.entry)}` };
      }
      if (t.kind === 'entry') {
        const s = sectionOf(data, t.entry);
        if (!s) return { ok: false, message: 'Already removed.' };
        const name = label(t.entry);
        s.entries.splice(s.entries.indexOf(t.entry), 1);
        return { ok: true, message: 'Entry removed from this CV (still in the library).', change: `Removed ${name}` };
      }
      const s = sectionOfGroup(data, t.group);
      if (!s) return { ok: false, message: 'Already removed.' };
      s.skillGroups.splice(s.skillGroups.indexOf(t.group), 1);
      return { ok: true, message: 'Skill group removed.', change: `Removed the "${short(t.group.category || 'skills')}" skills` };
    }

    case 'move': {
      const { target, position: pos } = args as { target: string; position: number };
      const t = ref(target);
      if (!t) return { ok: false, message: `No ${target}.` };
      if (t.kind === 'bullet') {
        const i = bulletIndex(t);
        if (i < 0) return { ok: false, message: 'That bullet was removed.' };
        const [b] = t.entry.bullets.splice(i, 1);
        place(t.entry.bullets, b, pos);
        return { ok: true, message: 'Moved.', change: `Reordered bullets in ${label(t.entry)}` };
      }
      if (t.kind === 'entry') {
        const s = sectionOf(data, t.entry);
        if (!s) return { ok: false, message: 'That entry was removed.' };
        s.entries.splice(s.entries.indexOf(t.entry), 1);
        place(s.entries, t.entry, pos);
        return { ok: true, message: 'Moved.', change: `Moved ${label(t.entry)} to position ${pos}` };
      }
      const s = sectionOfGroup(data, t.group);
      if (!s) return { ok: false, message: 'That group was removed.' };
      s.skillGroups.splice(s.skillGroups.indexOf(t.group), 1);
      place(s.skillGroups, t.group, pos);
      return { ok: true, message: 'Moved.', change: `Moved the "${short(t.group.category || 'skills')}" skills` };
    }

    case 'set_skills': {
      const { group, skills } = args as { group: string; skills: string[] };
      const t = ref(group);
      if (t?.kind !== 'group') return { ok: false, message: `No skill group ${group}.` };
      const clean = skills.map((x) => x.trim()).filter(Boolean);
      if (!clean.length) return { ok: false, message: 'No skills given; use remove to drop the group.' };
      t.group.skills = clean;
      return { ok: true, message: 'Skills updated.', change: `Updated the "${short(t.group.category || 'skills')}" skills` };
    }

    case 'add_library_entry': {
      const { libraryId, position: pos } = args as { libraryId: string; position?: number };
      const x = library?.entries.find((y) => y.id === libraryId);
      if (!x) return { ok: false, message: `No library entry ${libraryId}.` };
      const s = data.sections.find((y) => y.sectionId === x.sectionId);
      if (!s) return { ok: false, message: `This CV has no ${x.sectionId} section.` };
      if (s.entries.some((y) => y.entryId === x.id)) return { ok: false, message: 'That entry is already on the CV.' };
      const entry: RenderedEntry = {
        entryId: x.id,
        title: x.title,
        subtitle: x.subtitle,
        location: x.location,
        dateText: x.dateText,
        note: x.note,
        link: x.link,
        links: (x.links ?? []).map((l) => ({ ...l })),
        group: x.group,
        bullets: x.bullets.map((b) => b.text),
      };
      place(s.entries, entry, pos);
      return { ok: true, message: `Added "${x.title}" with ${x.bullets.length} bullets.`, change: `Added ${label(entry)} from your library` };
    }

    case 'add_entry': {
      const a = args as { sectionId: string; title: string; subtitle?: string; date?: string; location?: string; bullets: string[]; position?: number };
      const s = data.sections.find((y) => y.sectionId === a.sectionId);
      if (!s) return { ok: false, message: `No section ${a.sectionId} on this CV.` };
      const entry: RenderedEntry = {
        title: a.title.trim(),
        subtitle: a.subtitle?.trim() || undefined,
        dateText: a.date?.trim() || undefined,
        location: a.location?.trim() || undefined,
        links: [],
        bullets: a.bullets.map((b) => b.trim()).filter(Boolean),
      };
      place(s.entries, entry, a.position);
      return { ok: true, message: 'Entry added.', change: `Added ${label(entry)}` };
    }

    case 'set_style': {
      const { target, section, color } = args as { target: keyof typeof STYLE_LABEL; section?: string; color: string };
      const value = color.trim().toLowerCase();
      const reset = value === 'default';
      if (!reset && !COLOR.test(value)) return { ok: false, message: `"${color}" is not a colour: give a hex value like #1d4ed8.` };
      const style: CvStyle = structuredClone(data.style ?? {});
      let where = 'the whole CV';
      if (section) {
        const s = data.sections.find((x) => x.sectionId === section && !x.hidden);
        if (!s) return { ok: false, message: `No section ${section} on this CV.` };
        if (target !== 'headings' && target !== 'titles' && target !== 'text') {
          return { ok: false, message: 'Only headings, titles and text can be coloured per section; omit section for the rest.' };
        }
        const own = { ...(style.sections?.[section] ?? {}) };
        if (reset) delete own[target];
        else own[target] = value;
        style.sections = { ...(style.sections ?? {}), [section]: own };
        if (!Object.keys(own).length) delete style.sections[section];
        where = `"${sectionTitle(s, design)}"`;
      } else {
        const colors = { ...(style.colors ?? {}) };
        if (reset) delete colors[target];
        else colors[target] = value;
        style.colors = colors;
      }
      if (style.colors && !Object.keys(style.colors).length) delete style.colors;
      if (style.sections && !Object.keys(style.sections).length) delete style.sections;
      if (JSON.stringify(style) === JSON.stringify(data.style ?? {})) return { ok: true, message: 'Already that colour; nothing changed.' };
      if (Object.keys(style).length) data.style = style;
      else delete data.style;
      const what = section ? `${where} ${STYLE_LABEL[target]}` : `the ${STYLE_LABEL[target]}`;
      return {
        ok: true,
        message: reset ? `${what} back to the design's colour.` : `${what} now ${value}.`,
        change: reset ? `Reset the colour of ${what}` : `Coloured ${what} ${value}`,
      };
    }

    case 'set_design': {
      const { property, value } = args as { property: DesignProp; value: string | number };
      const label = DESIGN_PROPS[property].label;
      const reset = String(value).trim().toLowerCase() === 'default';
      const next = reset ? null : validProp(property, value);
      if (!reset && next === null) return { ok: false, message: `${String(value)} is not allowed for ${property}; see the tool's options.` };
      const style: CvStyle = structuredClone(data.style ?? {});
      const props = { ...(style.design ?? {}) };
      if (reset) delete props[property];
      else props[property] = next!;
      if (Object.keys(props).length) style.design = props;
      else delete style.design;
      if (JSON.stringify(style) === JSON.stringify(data.style ?? {})) return { ok: true, message: 'Already set that way; nothing changed.' };
      if (Object.keys(style).length) data.style = style;
      else delete data.style;
      return reset
        ? { ok: true, message: `${label} back to the original.`, change: `Put the ${label} back to the original` }
        : { ok: true, message: `${label} now ${next}.`, change: `Set the ${label} to ${describeProp(property, next!)}` };
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt

export const CHAT_SYSTEM = `You edit one CV for its owner, in conversation. They ask for changes ("make the summary target this role", "cut the oldest internship", "add a bullet about my React Native work", "fit it on one page") and you make them with the edit tools. You can also change this CV's look: colours with set_style ("make the project names blue"), and fonts, sizes, weights, heading style, alignment, spacing, bullets and margins with set_design. Look changes apply to this CV only, and the user can undo any reply. Anything outside those tools (moving sections into columns, adding photos or icons) you cannot do: say so and offer what you can.

## Truth

- Never invent facts: no new employers, titles, dates, numbers, metrics, technologies or achievements. Use only what is in the CV, the Career Library, or what the user tells you in this chat.
- Rewording is fine - tighter, clearer, more relevant to a job - as long as every fact survives and nothing is added. Keep the CV's own voice and tense.
- If a request needs facts you do not have ("add metrics"), ask for them instead of guessing. You may make the rest of the edits first.

## Editing

- Address everything by the references in the CV view: E3 is an entry, E3.2 its second bullet, G1 a skill group; "headline" and "summary" are the header line and the summary text.
- References always point at the view you were given at the start of your turn, even after your own edits in the turn moved things.
- Make every edit the request needs, then stop. Do not touch what the user did not ask about.
- Length matters: the page count is given. When asked to fit a page, shorten or drop the least relevant material; when adding, mention if the CV may now run longer.
- Prefer bringing back a Career Library entry (add_library_entry) over writing a new one when it covers the request.
- Design: the DESIGN part of the view shows current values; change by sensible steps (a size by 1-2pt) unless told an exact value, and mention when a change may push the CV onto another page.
- Colours: the STYLE part of the view shows the current ones. Use hex values; pick a shade that reads well on white (for "blue", something like #1d4ed8). "Project names" or "job titles" are entry titles: colour them for their section only, unless asked for every section.

## Replying

Make your edits first, without commentary. Then reply in one to three short sentences: what you changed, and anything you could not do or need from them. No lists of every edit - the app shows those. Plain text only: no markdown, no asterisks or headings; a simple "- " list is fine when you ask for several things. If the request is a question, answer it without editing.`;

/** The user's message as the model sees it: the request plus the current CV. */
export function turnPrompt(view: DocView, request: string, pages: { now?: number; original?: number }, jobDescription?: string): string {
  const length =
    pages.now != null
      ? `This CV currently runs to ${pages.now} page(s)${pages.original ? `; the original was ${pages.original}` : ''}.`
      : '';
  return [
    jobDescription?.trim() ? `This CV is tailored to this job:\n<job>\n${jobDescription.trim()}\n</job>\n` : '',
    `<cv>\n${view.text}\n</cv>`,
    length,
    '',
    `<request>\n${request}\n</request>`,
  ]
    .filter((x) => x !== '')
    .join('\n');
}
