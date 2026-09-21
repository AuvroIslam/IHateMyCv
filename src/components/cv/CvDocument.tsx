import type { CSSProperties } from 'react';
import { fontStack } from '@/lib/fonts';
import type {
  CvDocumentData,
  DesignSpec,
  RenderedEntry,
  RenderedSection,
  RenderedSkillGroup,
  SectionDef,
} from '@/types/cv';

/**
 * Renders a CV as (design x content).
 *
 * Nothing in here reads the content to decide how to look, and nothing reads
 * the design to decide what to say. That separation is the whole product: a
 * tailored CV swaps the content argument and is visually identical.
 *
 * All measurements are in pt/mm so the on-screen preview and the printed PDF
 * are the same document.
 */

const PAGE_SIZES = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
} as const;

export function pageDimensions(design: DesignSpec) {
  return PAGE_SIZES[design.page.size] ?? PAGE_SIZES.a4;
}

function pt(n: number) {
  return `${n}pt`;
}

export default function CvDocument({
  design,
  data,
  className,
}: {
  design: DesignSpec;
  data: CvDocumentData;
  className?: string;
}) {
  const page = pageDimensions(design);

  const rootStyle: CSSProperties = {
    width: `${page.width}mm`,
    minHeight: `${page.height}mm`,
    paddingTop: `${design.page.marginTop}mm`,
    paddingRight: `${design.page.marginRight}mm`,
    paddingBottom: `${design.page.marginBottom}mm`,
    paddingLeft: `${design.page.marginLeft}mm`,
    background: '#ffffff',
    color: design.color.text,
    fontFamily: fontStack(design.font.bodyFamily),
    fontSize: pt(design.font.baseSizePt),
    lineHeight: design.font.lineHeight,
    boxSizing: 'border-box',
  };

  const byId = new Map(data.sections.map((s) => [s.sectionId, s]));
  const visible = (defs: SectionDef[]) =>
    defs.filter((def) => {
      const s = byId.get(def.id);
      return s && !s.hidden && sectionHasContent(def, s);
    });

  const mainDefs = visible(design.sections.filter((s) => s.column === 'main'));
  const sideDefs = visible(design.sections.filter((s) => s.column === 'side'));
  const twoColumn = design.layout.type === 'two-column' && sideDefs.length > 0;

  const renderColumn = (defs: SectionDef[]) =>
    defs.map((def) => (
      <Section key={def.id} design={design} def={def} section={byId.get(def.id)!} />
    ));

  const main = <>{renderColumn(mainDefs)}</>;
  const side = <>{renderColumn(sideDefs)}</>;

  return (
    <div className={className} style={rootStyle} data-cv-root="true">
      <Header design={design} data={data} />
      {twoColumn ? (
        <div style={{ display: 'flex', gap: pt(18), alignItems: 'flex-start' }}>
          {design.layout.sideColumn === 'left' && (
            <div style={{ width: `${design.layout.sideWidthPct}%`, flexShrink: 0 }}>{side}</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>{main}</div>
          {design.layout.sideColumn === 'right' && (
            <div style={{ width: `${design.layout.sideWidthPct}%`, flexShrink: 0 }}>{side}</div>
          )}
        </div>
      ) : (
        <>
          {main}
          {side}
        </>
      )}
    </div>
  );
}

function sectionHasContent(def: SectionDef, s: RenderedSection): boolean {
  if (def.type === 'summary') return Boolean(s.summary?.trim());
  if (def.type === 'skills') return s.skillGroups.some((g) => g.skills.length > 0);
  return s.entries.length > 0;
}

// ---------------------------------------------------------------------------

function Header({ design, data }: { design: DesignSpec; data: CvDocumentData }) {
  const h = design.header;
  const { personal } = data;

  const primary = [personal.email, personal.phone, personal.location].filter(Boolean) as string[];
  const linkItems = personal.links.filter((l) => l.label?.trim());

  const linkEl = (label: string, href?: string) =>
    href ? (
      <a href={href} style={{ color: 'inherit', textDecoration: 'none' }}>
        {label}
      </a>
    ) : (
      <span>{label}</span>
    );

  const allItems = [
    ...primary.map((t) => <span key={t}>{t}</span>),
    ...linkItems.map((l) => <span key={l.id}>{linkEl(l.label, l.href)}</span>),
  ];

  const join = (items: React.ReactNode[]) =>
    items.flatMap((item, i) =>
      i === 0 ? [item] : [<span key={`sep-${i}`}>{h.contactSeparator}</span>, item],
    );

  const contactStyle: CSSProperties = {
    fontSize: pt(h.contactSizePt),
    color: design.color.muted,
  };

  let contact: React.ReactNode;
  if (h.contactLayout === 'stacked') {
    contact = (
      <div style={contactStyle}>
        {allItems.map((item, i) => (
          <div key={i}>{item}</div>
        ))}
      </div>
    );
  } else if (h.contactLayout === 'two-line') {
    contact = (
      <div style={contactStyle}>
        <div>{join(primary.map((t) => <span key={t}>{t}</span>))}</div>
        {linkItems.length > 0 && (
          <div>{join(linkItems.map((l) => <span key={l.id}>{linkEl(l.label, l.href)}</span>))}</div>
        )}
      </div>
    );
  } else {
    contact = <div style={contactStyle}>{join(allItems)}</div>;
  }

  return (
    <header
      style={{
        textAlign: h.align,
        marginBottom: pt(h.spaceBelowPt),
        paddingBottom: h.ruleBelow ? pt(4) : undefined,
        borderBottom: h.ruleBelow ? `${design.sectionHeading.rulePt || 0.75}pt solid ${design.color.rule}` : undefined,
      }}
    >
      <div
        style={{
          fontFamily: fontStack(design.font.headingFamily),
          fontSize: pt(h.nameSizePt),
          fontWeight: h.nameWeight,
          textTransform: h.nameTransform === 'uppercase' ? 'uppercase' : 'none',
          letterSpacing: `${h.nameLetterSpacingEm}em`,
          color: h.nameColor,
          lineHeight: 1.15,
        }}
      >
        {personal.fullName}
      </div>
      {h.headlineShown && personal.headline && (
        <div
          style={{
            fontSize: pt(h.headlineSizePt),
            fontStyle: h.headlineStyle,
            color: design.color.muted,
            marginTop: pt(2),
          }}
        >
          {personal.headline}
        </div>
      )}
      {allItems.length > 0 && <div style={{ marginTop: pt(3) }}>{contact}</div>}
    </header>
  );
}

// ---------------------------------------------------------------------------

function SectionHeading({ design, title }: { design: DesignSpec; title: string }) {
  const s = design.sectionHeading;
  const base: CSSProperties = {
    fontFamily: fontStack(design.font.headingFamily),
    fontSize: pt(s.sizePt),
    fontWeight: s.weight,
    textTransform:
      s.transform === 'uppercase' ? 'uppercase' : s.transform === 'capitalize' ? 'capitalize' : 'none',
    letterSpacing: `${s.letterSpacingEm}em`,
    color: s.color,
    textAlign: s.align,
    marginTop: pt(s.spaceBeforePt),
    marginBottom: pt(s.spaceAfterPt),
    lineHeight: 1.2,
  };

  if (s.style === 'filled-bar') {
    return (
      <div
        style={{
          ...base,
          background: design.color.accent,
          color: '#ffffff',
          padding: `${pt(2)} ${pt(5)}`,
        }}
      >
        {title}
      </div>
    );
  }

  if (s.style === 'rule-after') {
    return (
      <div
        style={{
          ...base,
          borderBottom: `${s.rulePt || 0.75}pt solid ${design.color.rule}`,
          paddingBottom: pt(1.5),
        }}
      >
        {title}
      </div>
    );
  }

  if (s.style === 'underline') {
    return (
      <div style={{ ...base, marginBottom: pt(s.spaceAfterPt) }}>
        <span
          style={{
            borderBottom: `${s.rulePt || 0.75}pt solid ${design.color.rule}`,
            paddingBottom: pt(1),
          }}
        >
          {title}
        </span>
      </div>
    );
  }

  return <div style={base}>{title}</div>;
}

function Section({
  design,
  def,
  section,
}: {
  design: DesignSpec;
  def: SectionDef;
  section: RenderedSection;
}) {
  return (
    <section>
      <SectionHeading design={design} title={section.title ?? def.title} />
      {def.type === 'summary' && section.summary && (
        <p style={{ margin: 0, textAlign: 'justify' }}>{section.summary}</p>
      )}
      {def.type === 'skills' && <Skills design={design} groups={section.skillGroups} />}
      {def.type !== 'summary' &&
        def.type !== 'skills' &&
        section.entries.map((entry, i) => (
          <Entry
            key={entry.entryId ?? `${def.id}-${i}`}
            design={design}
            entry={entry}
            isLast={i === section.entries.length - 1}
          />
        ))}
    </section>
  );
}

// ---------------------------------------------------------------------------

function Entry({
  design,
  entry,
  isLast,
}: {
  design: DesignSpec;
  entry: RenderedEntry;
  isLast: boolean;
}) {
  const e = design.entry;

  const titleStyle: CSSProperties = {
    fontSize: pt(e.titleSizePt),
    fontWeight: e.titleWeight,
  };
  const subtitleStyle: CSSProperties = {
    fontSize: pt(e.subtitleSizePt),
    fontStyle: e.subtitleStyle === 'italic' ? 'italic' : 'normal',
    fontWeight: e.subtitleStyle === 'bold' ? 600 : 'normal',
  };
  const dateStyle: CSSProperties = {
    fontSize: pt(e.dateSizePt),
    fontStyle: e.dateStyle,
    color: design.color.muted,
    whiteSpace: 'nowrap',
    paddingLeft: pt(8),
  };

  const titleNode = entry.link ? (
    <a href={entry.link} style={{ color: 'inherit', textDecoration: 'none' }}>
      {entry.title}
    </a>
  ) : (
    entry.title
  );

  const inlineDate = e.dateAlign === 'inline' && entry.dateText;

  // `compact` collapses title, subtitle and date onto a single line.
  if (e.layout === 'compact') {
    return (
      <div style={{ marginBottom: isLast ? 0 : pt(e.spacingPt) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ minWidth: 0 }}>
            <span style={titleStyle}>{titleNode}</span>
            {entry.subtitle && (
              <span style={subtitleStyle}>
                {' — '}
                {entry.subtitle}
              </span>
            )}
            {inlineDate && <span style={{ ...dateStyle, paddingLeft: pt(6) }}>{entry.dateText}</span>}
          </div>
          {!inlineDate && entry.dateText && <div style={dateStyle}>{entry.dateText}</div>}
        </div>
        <Bullets design={design} bullets={entry.bullets} />
      </div>
    );
  }

  // `title-then-subtitle` puts location on the title row and the date beside
  // the subtitle; the default puts the date on the title row.
  const swapped = e.layout === 'title-then-subtitle';
  const row1Right = swapped ? entry.location : entry.dateText;
  const row2Right = swapped ? entry.dateText : entry.location;

  return (
    <div style={{ marginBottom: isLast ? 0 : pt(e.spacingPt) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ ...titleStyle, minWidth: 0 }}>
          {titleNode}
          {inlineDate && <span style={{ ...dateStyle, fontWeight: 'normal' }}>{entry.dateText}</span>}
        </div>
        {!inlineDate && row1Right && <div style={dateStyle}>{row1Right}</div>}
      </div>

      {(entry.subtitle || (!inlineDate && row2Right)) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ ...subtitleStyle, minWidth: 0 }}>{entry.subtitle}</div>
          {!inlineDate && row2Right && <div style={dateStyle}>{row2Right}</div>}
        </div>
      )}

      <Bullets design={design} bullets={entry.bullets} />
    </div>
  );
}

function Bullets({ design, bullets }: { design: DesignSpec; bullets: string[] }) {
  const e = design.entry;
  if (!bullets.length) return null;
  return (
    <ul style={{ listStyle: 'none', margin: `${pt(2)} 0 0 0`, padding: 0 }}>
      {bullets.map((text, i) => (
        <li
          key={i}
          style={{
            display: 'flex',
            fontSize: pt(e.bulletSizePt),
            marginBottom: i === bullets.length - 1 ? 0 : pt(e.bulletSpacingPt),
            paddingLeft: pt(e.bulletIndentPt),
          }}
        >
          <span style={{ flexShrink: 0, width: pt(Math.max(8, e.bulletIndentPt)) }}>
            {e.bulletChar}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
        </li>
      ))}
    </ul>
  );
}

function Skills({ design, groups }: { design: DesignSpec; groups: RenderedSkillGroup[] }) {
  const s = design.skills;
  const e = design.entry;
  const live = groups.filter((g) => g.skills.length > 0);
  if (!live.length) return null;

  if (s.layout === 'comma-list') {
    return <div>{live.flatMap((g) => g.skills).join(s.separator)}</div>;
  }

  if (s.layout === 'pills') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: pt(4) }}>
        {live.flatMap((g) =>
          g.skills.map((skill) => (
            <span
              key={`${g.category}-${skill}`}
              style={{
                border: `0.5pt solid ${design.color.rule}`,
                borderRadius: pt(3),
                padding: `${pt(1)} ${pt(5)}`,
                fontSize: pt(design.font.baseSizePt - 0.5),
              }}
            >
              {skill}
            </span>
          )),
        )}
      </div>
    );
  }

  if (s.layout === 'bullets') {
    return (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {live.map((g, i) => (
          <li
            key={i}
            style={{
              display: 'flex',
              marginBottom: i === live.length - 1 ? 0 : pt(e.bulletSpacingPt),
              paddingLeft: pt(e.bulletIndentPt),
            }}
          >
            <span style={{ flexShrink: 0, width: pt(Math.max(8, e.bulletIndentPt)) }}>
              {e.bulletChar}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              {g.category && <span style={{ fontWeight: s.categoryWeight }}>{g.category}: </span>}
              {g.skills.join(s.separator)}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      {live.map((g, i) => (
        <div key={i} style={{ marginBottom: i === live.length - 1 ? 0 : pt(e.bulletSpacingPt) }}>
          {g.category && <span style={{ fontWeight: s.categoryWeight }}>{g.category}: </span>}
          <span>{g.skills.join(s.separator)}</span>
        </div>
      ))}
    </div>
  );
}
