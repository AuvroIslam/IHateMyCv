'use client';

import { useState } from 'react';
import { Button, Input, Panel, cx } from '@/components/ui/kit';
import { FONT_CHOICES } from '@/lib/fonts';
import type { DesignSpec, SectionDef } from '@/types/cv';

/**
 * Corrects the captured design. This is not a theme picker: every control maps
 * to something measured from the original, and exists so a mis-measurement can
 * be put right once, for every CV generated from here on.
 */

type FieldSpec =
  | { path: string; label: string; kind: 'number'; step: number; unit?: string }
  | { path: string; label: string; kind: 'select'; options: readonly string[] }
  | { path: string; label: string; kind: 'font' | 'color' | 'text' | 'boolean' | 'order' };

const n = (path: string, label: string, step: number, unit?: string): FieldSpec => ({
  path,
  label,
  kind: 'number',
  step,
  unit,
});
const sel = (path: string, label: string, options: readonly string[]): FieldSpec => ({
  path,
  label,
  kind: 'select',
  options,
});
const other = (
  path: string,
  label: string,
  kind: 'font' | 'color' | 'text' | 'boolean' | 'order',
): FieldSpec => ({
  path,
  label,
  kind,
});

const GROUPS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: 'Page',
    fields: [
      sel('page.size', 'Paper', ['a4', 'letter']),
      n('page.marginTop', 'Top margin', 0.5, 'mm'),
      n('page.marginBottom', 'Bottom margin', 0.5, 'mm'),
      n('page.marginLeft', 'Left margin', 0.5, 'mm'),
      n('page.marginRight', 'Right margin', 0.5, 'mm'),
    ],
  },
  {
    title: 'Type',
    fields: [
      other('font.useEmbedded', 'Use fonts from your PDF', 'boolean'),
      other('font.bodyFamily', 'Body font', 'font'),
      other('font.headingFamily', 'Heading font', 'font'),
      n('font.baseSizePt', 'Body size', 0.1, 'pt'),
      n('font.lineHeight', 'Line height', 0.01),
      sel('font.textAlign', 'Paragraphs', ['left', 'justify']),
    ],
  },
  {
    title: 'Header',
    fields: [
      sel('header.align', 'Alignment', ['left', 'center']),
      n('header.nameSizePt', 'Name size', 0.5, 'pt'),
      n('header.nameWeight', 'Name weight', 100),
      sel('header.nameTransform', 'Name case', ['none', 'uppercase']),
      n('header.nameLetterSpacingEm', 'Name tracking', 0.01, 'em'),
      other('header.headlineShown', 'Show headline', 'boolean'),
      n('header.headlineSizePt', 'Headline size', 0.1, 'pt'),
      n('header.contactSizePt', 'Contact size', 0.1, 'pt'),
      other('header.contactSeparator', 'Contact separator', 'text'),
      sel('header.contactLayout', 'Contact layout', ['inline', 'stacked', 'two-line']),
      other('header.contactOrder', 'Contact order', 'order'),
      other('header.contactLabels.phone', 'Phone label', 'text'),
      other('header.contactLabels.email', 'Email label', 'text'),
      other('header.contactLabels.location', 'Location label', 'text'),
      n('header.contactLabelWeight', 'Label weight', 100),
      other('header.ruleBelow', 'Rule below header', 'boolean'),
      n('header.spaceBelowPt', 'Space below', 0.5, 'pt'),
    ],
  },
  {
    title: 'Section headings',
    fields: [
      n('sectionHeading.sizePt', 'Size', 0.1, 'pt'),
      n('sectionHeading.weight', 'Weight', 100),
      sel('sectionHeading.transform', 'Case', ['none', 'uppercase', 'capitalize']),
      n('sectionHeading.letterSpacingEm', 'Tracking', 0.01, 'em'),
      sel('sectionHeading.align', 'Alignment', ['left', 'center']),
      sel('sectionHeading.style', 'Style', ['plain', 'underline', 'rule-after', 'filled-bar']),
      n('sectionHeading.rulePt', 'Rule thickness', 0.1, 'pt'),
      n('sectionHeading.spaceBeforePt', 'Space before', 0.5, 'pt'),
      n('sectionHeading.spaceAfterPt', 'Space after', 0.5, 'pt'),
    ],
  },
  {
    title: 'Entries',
    fields: [
      sel('entry.layout', 'Layout', ['title-left-date-right', 'title-then-subtitle', 'compact']),
      n('entry.titleSizePt', 'Title size', 0.1, 'pt'),
      n('entry.titleWeight', 'Title weight', 100),
      sel('entry.subtitleStyle', 'Subtitle style', ['normal', 'italic', 'bold']),
      n('entry.subtitleSizePt', 'Subtitle size', 0.1, 'pt'),
      sel('entry.dateAlign', 'Date position', ['right', 'inline']),
      sel('entry.dateStyle', 'Date style', ['normal', 'italic']),
      n('entry.dateSizePt', 'Date size', 0.1, 'pt'),
      n('entry.spacingPt', 'Gap between entries', 0.5, 'pt'),
    ],
  },
  {
    title: 'Bullets',
    fields: [
      other('entry.bulletChar', 'Bullet glyph', 'text'),
      n('entry.bulletSizePt', 'Bullet text size', 0.1, 'pt'),
      n('entry.bulletIndentPt', 'Bullet indent', 0.5, 'pt'),
      n('entry.bulletTextIndentPt', 'Text indent', 0.5, 'pt'),
      n('entry.bulletSpacingPt', 'Gap between bullets', 0.25, 'pt'),
    ],
  },
  {
    title: 'Links',
    fields: [
      sel('entry.linksPlacement', 'Entry links', ['bullet', 'title-line', 'own-line']),
      other('entry.linkSeparator', 'Between links', 'text'),
      other('color.link', 'Link colour', 'color'),
    ],
  },
  {
    title: 'Skills',
    fields: [
      sel('skills.layout', 'Layout', ['inline-categories', 'bullets', 'comma-list', 'pills']),
      n('skills.categoryWeight', 'Category weight', 100),
      other('skills.separator', 'Separator', 'text'),
    ],
  },
  {
    title: 'Colour',
    fields: [
      other('color.text', 'Text', 'color'),
      other('color.muted', 'Secondary text', 'color'),
      other('header.nameColor', 'Name', 'color'),
      other('sectionHeading.color', 'Headings', 'color'),
      other('color.rule', 'Rules', 'color'),
      other('color.accent', 'Accent / bars', 'color'),
    ],
  },
  {
    title: 'Columns',
    fields: [
      sel('layout.type', 'Layout', ['single', 'two-column']),
      sel('layout.sideColumn', 'Side column', ['left', 'right']),
      n('layout.sideWidthPct', 'Side width', 1, '%'),
    ],
  },
];

function getAt(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

function setAt<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const current = (obj as Record<string, unknown>)[head];
  return {
    ...obj,
    [head]: rest.length ? setAt(current, rest.join('.'), value) : value,
  };
}

export default function DesignEditor({
  design,
  onChange,
}: {
  design: DesignSpec;
  onChange: (next: DesignSpec) => void;
}) {
  const [open, setOpen] = useState<string | null>('Type');

  return (
    <div className="space-y-2">
      {GROUPS.map((group) => {
        const expanded = open === group.title;
        return (
          <Panel key={group.title} className="overflow-hidden">
            <button
              onClick={() => setOpen(expanded ? null : group.title)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
            >
              <span className="text-subtle">{expanded ? '▾' : '▸'}</span>
              {group.title}
            </button>
            {expanded && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-line p-3">
                {group.title === 'Type' && <EmbeddedFontsNote design={design} />}
                {group.fields
                  .filter((f) => f.path !== 'font.useEmbedded' || design.font.embedded.length > 0)
                  .map((field) => (
                  <FieldControl
                    key={field.path}
                    field={field}
                    value={getAt(design, field.path)}
                    onChange={(v) => onChange(setAt(design, field.path, v))}
                  />
                ))}
              </div>
            )}
          </Panel>
        );
      })}

      <Panel className="overflow-hidden">
        <button
          onClick={() => setOpen(open === 'Sections' ? null : 'Sections')}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
        >
          <span className="text-subtle">{open === 'Sections' ? '▾' : '▸'}</span>
          Sections
        </button>
        {open === 'Sections' && (
          <SectionsEditor
            design={design}
            onChange={(sections) => onChange({ ...design, sections })}
          />
        )}
      </Panel>
    </div>
  );
}

function EmbeddedFontsNote({ design }: { design: DesignSpec }) {
  const faces = design.font.embedded;
  if (faces.length === 0) {
    return (
      <p className="col-span-2 text-xs text-subtle">
        No fonts could be taken from your file, so the closest match below is used. Upload a PDF
        to use its exact fonts.
      </p>
    );
  }
  const roles = ['name', 'heading', 'body'] as const;
  return (
    <div className="col-span-2 rounded-md bg-foreground/4 p-2 text-xs text-subtle">
      <p>
        {design.font.useEmbedded
          ? 'Using the exact fonts from your PDF. The fonts below fill in only for characters your original never used.'
          : 'Using the closest match below instead of your PDF’s own fonts.'}
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {roles.map((role) => {
          const sources = Array.from(new Set(faces.filter((f) => f.role === role).map((f) => f.source)));
          return (
            sources.length > 0 && (
              <li key={role}>
                <span className="capitalize">{role}</span>: <span className="font-mono">{sources.join(', ')}</span>
              </li>
            )
          );
        })}
      </ul>
    </div>
  );
}

const CONTROL =
  'w-full rounded-md border border-line bg-background px-2 py-1 text-sm outline-none focus:border-foreground/50';

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = (
    <span className="mb-0.5 block text-[11px] text-subtle">
      {field.label}
      {field.kind === 'number' && field.unit ? ` (${field.unit})` : ''}
    </span>
  );

  if (field.kind === 'order') {
    const order = Array.isArray(value) ? (value as string[]) : [];
    const move = (i: number, delta: number) => {
      const j = i + delta;
      if (j < 0 || j >= order.length) return;
      const next = [...order];
      [next[i], next[j]] = [next[j], next[i]];
      onChange(next);
    };
    return (
      <div className="col-span-2">
        {label}
        <div className="flex flex-wrap gap-1">
          {order.map((item, i) => (
            <span
              key={item}
              className="inline-flex items-center gap-0.5 rounded border border-line bg-background py-0.5 pr-0.5 pl-2 text-xs"
            >
              {item}
              <button
                className="px-1 text-subtle hover:text-foreground disabled:opacity-30"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label={`Move ${item} earlier`}
              >
                ←
              </button>
              <button
                className="px-1 text-subtle hover:text-foreground disabled:opacity-30"
                disabled={i === order.length - 1}
                onClick={() => move(i, 1)}
                aria-label={`Move ${item} later`}
              >
                →
              </button>
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (field.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2 self-end pb-1 text-sm">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {field.label}
      </label>
    );
  }

  let control: React.ReactNode;
  if (field.kind === 'number') {
    control = (
      <input
        type="number"
        step={field.step}
        className={CONTROL}
        value={typeof value === 'number' ? value : 0}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    );
  } else if (field.kind === 'select') {
    control = (
      <select className={CONTROL} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (field.kind === 'font') {
    control = (
      <select className={CONTROL} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {FONT_CHOICES.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
    );
  } else if (field.kind === 'color') {
    const hex = /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#000000';
    control = (
      <div className="flex gap-1.5">
        <input
          type="color"
          className="h-7 w-9 shrink-0 cursor-pointer rounded border border-line bg-background"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
        />
        <input className={CONTROL} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  } else {
    // Whitespace is significant here (" | " vs "|"), so show it rather than trim it.
    control = (
      <input
        className={cx(CONTROL, 'font-mono whitespace-pre')}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <label className="block min-w-0">
      {label}
      {control}
    </label>
  );
}

function SectionsEditor({
  design,
  onChange,
}: {
  design: DesignSpec;
  onChange: (sections: SectionDef[]) => void;
}) {
  const { sections } = design;
  const patch = (id: string, fields: Partial<SectionDef>) =>
    onChange(sections.map((s) => (s.id === id ? { ...s, ...fields } : s)));
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-2 border-t border-line p-3">
      <p className="text-xs text-subtle">
        Only fix what extraction got wrong: a mistyped heading, or sections read in the wrong
        order. Tailoring never changes these.
      </p>
      {sections.map((s, i) => (
        <div key={s.id} className="flex items-center gap-1.5">
          <Input
            value={s.title}
            className="flex-1 py-1"
            onChange={(e) => patch(s.id, { title: e.target.value })}
          />
          {design.layout.type === 'two-column' && (
            <select
              className={cx(CONTROL, 'w-20')}
              value={s.column}
              onChange={(e) => patch(s.id, { column: e.target.value as SectionDef['column'] })}
            >
              <option value="main">main</option>
              <option value="side">side</option>
            </select>
          )}
          <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={i === sections.length - 1}
            onClick={() => move(i, 1)}
          >
            ↓
          </Button>
        </div>
      ))}
    </div>
  );
}
