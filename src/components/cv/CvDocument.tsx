import type { CSSProperties, ReactNode } from 'react';
import { embeddedPrefix } from '@/lib/embedded-fonts';
import { fontStack } from '@/lib/fonts';
import type {
  CvDocumentData,
  DesignSpec,
  EntryLink,
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
 * The document is produced as a list of blocks that must not be split across
 * a page: the header, each section heading (kept with what follows), each
 * entry, each skills line. CvPreview measures them and deals them onto pages,
 * so the screen and the printed PDF break in exactly the same places.
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

/** Typography shared by every page and by the hidden measuring flow. */
export function textStyle(design: DesignSpec): CSSProperties {
  return {
    color: design.color.text,
    fontFamily: embeddedPrefix(design, 'body') + fontStack(design.font.bodyFamily),
    fontSize: pt(design.font.baseSizePt),
    lineHeight: design.font.lineHeight,
    // Justified text with no hyphenation opens rivers of white space; LaTeX
    // hyphenates, so matching its line breaks needs this too.
    hyphens: design.font.textAlign === 'justify' ? 'auto' : 'manual',
  };
}

/** Width available to content, inside the side margins. */
export function contentWidthMm(design: DesignSpec) {
  return pageDimensions(design).width - design.page.marginLeft - design.page.marginRight;
}

export function contentHeightMm(design: DesignSpec) {
  return pageDimensions(design).height - design.page.marginTop - design.page.marginBottom;
}

/** One physical page: exact paper size, margins as padding. */
export function pageStyle(design: DesignSpec): CSSProperties {
  const page = pageDimensions(design);
  return {
    ...textStyle(design),
    width: `${page.width}mm`,
    height: `${page.height}mm`,
    paddingTop: `${design.page.marginTop}mm`,
    paddingRight: `${design.page.marginRight}mm`,
    paddingBottom: `${design.page.marginBottom}mm`,
    paddingLeft: `${design.page.marginLeft}mm`,
    background: '#ffffff',
    boxSizing: 'border-box',
  };
}

// ---------------------------------------------------------------------------

function sectionHasContent(def: SectionDef, s: RenderedSection): boolean {
  if (def.type === 'summary') return Boolean(s.summary?.trim());
  if (def.type === 'skills') return s.skillGroups.some((g) => g.skills.length > 0);
  return s.entries.length > 0;
}

function visibleSections(design: DesignSpec, data: CvDocumentData, column: 'main' | 'side') {
  const byId = new Map(data.sections.map((s) => [s.sectionId, s]));
  return design.sections
    .filter((def) => def.column === column)
    .map((def) => ({ def, section: byId.get(def.id) }))
    .filter(
      (x): x is { def: SectionDef; section: RenderedSection } =>
        Boolean(x.section && !x.section.hidden && sectionHasContent(x.def, x.section)),
    );
}

/**
 * Two-column layouts cannot be dealt onto pages block by block (the columns
 * flow independently), so they keep the single continuous sheet.
 */
export function canPaginate(design: DesignSpec, data: CvDocumentData): boolean {
  return design.layout.type !== 'two-column' || visibleSections(design, data, 'side').length === 0;
}

export interface Block {
  key: string;
  node: ReactNode;
  /** Never end a page on this block (section headings). */
  keepWithNext: boolean;
}

export function buildBlocks(design: DesignSpec, data: CvDocumentData): Block[] {
  const blocks: Block[] = [
    { key: 'header', node: <Header design={design} data={data} />, keepWithNext: false },
  ];

  const sections = [...visibleSections(design, data, 'main'), ...visibleSections(design, data, 'side')];
  for (const { def, section } of sections) {
    blocks.push({
      key: `${def.id}:heading`,
      node: <SectionHeading design={design} title={section.title ?? def.title} />,
      keepWithNext: true,
    });

    if (def.type === 'summary') {
      blocks.push({
        key: `${def.id}:summary`,
        node: <Paragraph design={design}>{section.summary}</Paragraph>,
        keepWithNext: false,
      });
    } else if (def.type === 'skills') {
      skillBlocks(design, section.skillGroups).forEach((node, i) =>
        blocks.push({ key: `${def.id}:skills:${i}`, node, keepWithNext: false }),
      );
    } else {
      section.entries.forEach((entry, i) => {
        if (startsGroup(section.entries, i)) {
          blocks.push({
            key: `${def.id}:group:${i}`,
            node: <GroupLabel design={design} label={entry.group!} first={i === 0} />,
            keepWithNext: true,
          });
        }
        blocks.push({
          key: `${def.id}:${entry.entryId ?? i}`,
          node: <Entry design={design} entry={entry} isLast={i === section.entries.length - 1} />,
          keepWithNext: false,
        });
      });
    }
  }
  return blocks;
}

/** A sub-heading prints wherever the group changes, including after tailoring reorders. */
function startsGroup(entries: RenderedEntry[], i: number): boolean {
  const group = entries[i].group?.trim();
  return Boolean(group) && group !== entries[i - 1]?.group?.trim();
}

function GroupLabel({ design, label, first }: { design: DesignSpec; label: string; first: boolean }) {
  const g = design.entry.groupLabel;
  return (
    <div
      data-role="group"
      style={{
        fontWeight: g.weight,
        fontSize: pt(g.sizePt),
        textDecoration: g.underline ? 'underline' : 'none',
        marginTop: first ? 0 : pt(g.spaceBeforePt),
        marginBottom: pt(g.spaceAfterPt),
      }}
    >
      {label}
    </div>
  );
}

/**
 * The unpaginated document: one continuous sheet. Used for two-column
 * layouts, where blocks cannot be dealt onto pages independently.
 */
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
  const rootStyle: CSSProperties = { ...pageStyle(design), height: undefined, minHeight: `${page.height}mm` };

  const renderColumn = (column: 'main' | 'side') =>
    visibleSections(design, data, column).map(({ def, section }) => (
      <Section key={def.id} design={design} def={def} section={section} />
    ));

  const twoColumn = !canPaginate(design, data);

  return (
    <div className={className} style={rootStyle} lang="en" data-cv-root="true">
      <Header design={design} data={data} />
      {twoColumn ? (
        <div style={{ display: 'flex', gap: pt(18), alignItems: 'flex-start' }}>
          {design.layout.sideColumn === 'left' && (
            <div style={{ width: `${design.layout.sideWidthPct}%`, flexShrink: 0 }}>{renderColumn('side')}</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>{renderColumn('main')}</div>
          {design.layout.sideColumn === 'right' && (
            <div style={{ width: `${design.layout.sideWidthPct}%`, flexShrink: 0 }}>{renderColumn('side')}</div>
          )}
        </div>
      ) : (
        <>
          {renderColumn('main')}
          {renderColumn('side')}
        </>
      )}
    </div>
  );
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
      {def.type === 'summary' && <Paragraph design={design}>{section.summary}</Paragraph>}
      {def.type === 'skills' && skillBlocks(design, section.skillGroups)}
      {def.type !== 'summary' &&
        def.type !== 'skills' &&
        section.entries.map((entry, i) => (
          <div key={entry.entryId ?? `${def.id}-${i}`}>
            {startsGroup(section.entries, i) && <GroupLabel design={design} label={entry.group!} first={i === 0} />}
            <Entry design={design} entry={entry} isLast={i === section.entries.length - 1} />
          </div>
        ))}
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * A separator between items. With a measured gap, the glyph gets exactly that
 * much space on each side; otherwise its own spaces are kept verbatim
 * (" | " vs "  •  ").
 */
function Sep({ text, gapPt }: { text: string; gapPt?: number | null }) {
  if (gapPt == null) return <span style={{ whiteSpace: 'pre' }}>{text}</span>;
  return <span style={{ padding: `0 ${pt(Math.max(0, gapPt))}` }}>{text.trim() || text}</span>;
}

function Link({ design, href, children }: { design: DesignSpec; href?: string; children: ReactNode }) {
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} style={{ color: design.color.link, textDecoration: 'none' }}>
      {children}
    </a>
  );
}

/**
 * `pretty` wrapping weighs the whole paragraph instead of filling greedily,
 * which lands much closer to TeX's line breaks.
 */
const PROSE: CSSProperties = { textWrap: 'pretty' };

function Paragraph({ design, children }: { design: DesignSpec; children: ReactNode }) {
  return (
    <p data-role="summary" style={{ ...PROSE, margin: 0, textAlign: design.font.textAlign }}>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------

function Header({ design, data }: { design: DesignSpec; data: CvDocumentData }) {
  const h = design.header;
  const { personal } = data;

  const labelled = (label: string, value: ReactNode) => (
    <>
      {label && <span style={{ fontWeight: h.contactLabelWeight }}>{label} </span>}
      {value}
    </>
  );

  const itemsFor = (kind: (typeof h.contactOrder)[number]): { key: string; node: ReactNode }[] => {
    if (kind === 'phone' && personal.phone) {
      return [{ key: 'phone', node: labelled(h.contactLabels.phone, personal.phone) }];
    }
    if (kind === 'email' && personal.email) {
      return [
        {
          key: 'email',
          node: labelled(
            h.contactLabels.email,
            <Link design={design} href={`mailto:${personal.email}`}>
              {personal.email}
            </Link>,
          ),
        },
      ];
    }
    if (kind === 'location' && personal.location) {
      return [{ key: 'location', node: labelled(h.contactLabels.location, personal.location) }];
    }
    if (kind === 'links') {
      return personal.links
        .filter((l) => l.label?.trim())
        .map((l) => ({
          key: l.id,
          node: (
            <Link design={design} href={l.href}>
              {l.label}
            </Link>
          ),
        }));
    }
    return [];
  };

  // Anything the order omits still prints, after the ordered items.
  const kinds = Array.from(new Set([...h.contactOrder, 'phone', 'email', 'location', 'links'] as const));
  const primary = kinds.filter((k) => k !== 'links').flatMap(itemsFor);
  const links = itemsFor('links');
  const all = kinds.flatMap(itemsFor);

  const join = (items: { key: string; node: ReactNode }[]) =>
    items.flatMap((item, i) => [
      ...(i === 0 ? [] : [<Sep key={`sep-${item.key}`} text={h.contactSeparator} gapPt={h.contactGapPt} />]),
      <span key={item.key}>{item.node}</span>,
    ]);

  const contactStyle: CSSProperties = { fontSize: pt(h.contactSizePt), color: design.color.muted };

  let contact: ReactNode;
  if (h.contactLayout === 'stacked') {
    contact = (
      <div style={contactStyle}>
        {all.map((item) => (
          <div key={item.key} data-role="contact">
            {item.node}
          </div>
        ))}
      </div>
    );
  } else if (h.contactLayout === 'two-line') {
    contact = (
      <div style={contactStyle}>
        <div data-role="contact">{join(primary)}</div>
        {links.length > 0 && <div data-role="contact">{join(links)}</div>}
      </div>
    );
  } else {
    contact = (
      <div style={contactStyle} data-role="contact">
        {join(all)}
      </div>
    );
  }

  return (
    <header
      style={{
        textAlign: h.align,
        marginBottom: pt(h.spaceBelowPt),
        paddingBottom: h.ruleBelow ? pt(4) : undefined,
        borderBottom: h.ruleBelow
          ? `${design.sectionHeading.rulePt || 0.75}pt solid ${design.color.rule}`
          : undefined,
      }}
    >
      <div
        data-role="name"
        style={{
          fontFamily: embeddedPrefix(design, 'name') + fontStack(design.font.headingFamily),
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
      {all.length > 0 && <div style={{ marginTop: pt(h.contactTopPt) }}>{contact}</div>}
    </header>
  );
}

// ---------------------------------------------------------------------------

function SectionHeading({ design, title }: { design: DesignSpec; title: string }) {
  const s = design.sectionHeading;
  const base: CSSProperties = {
    fontFamily: embeddedPrefix(design, 'heading') + fontStack(design.font.headingFamily),
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
    hyphens: 'manual',
  };

  if (s.style === 'filled-bar') {
    return (
      <div
        data-role="heading"
        style={{ ...base, background: design.color.accent, color: '#ffffff', padding: `${pt(2)} ${pt(5)}` }}
      >
        {title}
      </div>
    );
  }

  if (s.style === 'rule-after') {
    return (
      <div
        data-role="heading"
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
      <div data-role="heading" style={base}>
        <span style={{ borderBottom: `${s.rulePt || 0.75}pt solid ${design.color.rule}`, paddingBottom: pt(1) }}>
          {title}
        </span>
      </div>
    );
  }

  return (
    <div data-role="heading" style={base}>
      {title}
    </div>
  );
}

// ---------------------------------------------------------------------------

function EntryLinks({ design, links }: { design: DesignSpec; links: EntryLink[] }) {
  return (
    <>
      {links.map((l, i) => (
        <span key={`${l.label}-${i}`}>
          {i > 0 && <Sep text={design.entry.linkSeparator} gapPt={design.entry.linkGapPt} />}
          <Link design={design} href={l.url || undefined}>
            {l.label}
          </Link>
        </span>
      ))}
    </>
  );
}

function Entry({ design, entry, isLast }: { design: DesignSpec; entry: RenderedEntry; isLast: boolean }) {
  const e = design.entry;
  const links = (entry.links ?? []).filter((l) => l.label.trim());

  const titleStyle: CSSProperties = { fontSize: pt(e.titleSizePt), fontWeight: e.titleWeight };
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

  const titleLinks =
    e.linksPlacement === 'title-line' && links.length > 0 ? (
      <span style={{ fontWeight: 'normal' }}>
        <Sep text={e.linkSeparator} gapPt={e.linkGapPt} />
        <EntryLinks design={design} links={links} />
      </span>
    ) : null;

  const ownLineLinks =
    e.linksPlacement === 'own-line' && links.length > 0 ? (
      <div data-role="links" style={{ marginTop: pt(e.subtitleGapPt) }}>
        <EntryLinks design={design} links={links} />
      </div>
    ) : null;

  const bulletLinks = e.linksPlacement === 'bullet' && links.length > 0 ? links : [];
  const inlineDate = e.dateAlign === 'inline' && entry.dateText;
  const wrap: CSSProperties = { marginBottom: isLast ? 0 : pt(e.spacingPt) };
  const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' };
  const row2: CSSProperties = { ...row, marginTop: pt(e.subtitleGapPt) };
  const bullets = <Bullets design={design} bullets={entry.bullets} links={bulletLinks} />;

  // `compact` collapses title, subtitle and date onto a single line.
  if (e.layout === 'compact') {
    return (
      <div style={wrap}>
        <div style={row} data-role="title">
          <div style={{ minWidth: 0 }}>
            <span style={titleStyle}>{titleNode}</span>
            {entry.subtitle && (
              <span style={subtitleStyle}>
                {' — '}
                {entry.subtitle}
              </span>
            )}
            {titleLinks}
            {inlineDate && <span style={{ ...dateStyle, paddingLeft: pt(6) }}>{entry.dateText}</span>}
          </div>
          {!inlineDate && entry.dateText && <div style={dateStyle}>{entry.dateText}</div>}
        </div>
        {ownLineLinks}
        {bullets}
      </div>
    );
  }

  // `org-title`: "Company – Role" in title style on one line, date right,
  // location alone underneath.
  if (e.layout === 'org-title') {
    return (
      <div style={wrap}>
        <div style={row} data-role="title">
          <div style={{ ...titleStyle, minWidth: 0 }}>
            {entry.subtitle && (
              <>
                {entry.subtitle}
                <span style={{ whiteSpace: 'pre' }}>{e.titleJoiner}</span>
              </>
            )}
            {titleNode}
            {titleLinks}
          </div>
          {entry.dateText && <div style={{ ...dateStyle, fontWeight: e.titleWeight }}>{entry.dateText}</div>}
        </div>
        {entry.location && (
          <div style={{ ...row2, ...subtitleStyle }} data-role="subtitle">
            {entry.location}
          </div>
        )}
        {ownLineLinks}
        {bullets}
      </div>
    );
  }

  // `title-then-subtitle` puts location on the title row and the date beside
  // the subtitle; the default puts the date on the title row.
  const swapped = e.layout === 'title-then-subtitle';
  const row1Right = swapped ? entry.location : entry.dateText;
  const row2Right = swapped ? entry.dateText : entry.location;

  return (
    <div style={wrap}>
      <div style={row} data-role="title">
        <div style={{ ...titleStyle, minWidth: 0 }}>
          {titleNode}
          {titleLinks}
          {inlineDate && <span style={{ ...dateStyle, fontWeight: 'normal' }}>{entry.dateText}</span>}
        </div>
        {!inlineDate && row1Right && <div style={{ ...dateStyle, fontWeight: e.titleWeight }}>{row1Right}</div>}
      </div>

      {(entry.subtitle || (!inlineDate && row2Right)) && (
        <div style={row2} data-role="subtitle">
          <div style={{ ...subtitleStyle, minWidth: 0 }}>{entry.subtitle}</div>
          {!inlineDate && row2Right && <div style={dateStyle}>{row2Right}</div>}
        </div>
      )}

      {ownLineLinks}
      {bullets}
    </div>
  );
}

function BulletRow({
  design,
  last,
  role = 'bullet',
  children,
}: {
  design: DesignSpec;
  last: boolean;
  role?: string;
  children: ReactNode;
}) {
  const e = design.entry;
  // The glyph sits at bulletIndentPt; the text hangs at bulletTextIndentPt,
  // so wrapped lines align under the first word rather than the bullet.
  const glyphBox = Math.max(2, e.bulletTextIndentPt - e.bulletIndentPt);
  return (
    <li
      data-role={role}
      style={{
        display: 'flex',
        fontSize: pt(e.bulletSizePt),
        marginBottom: last ? 0 : pt(e.bulletSpacingPt),
        paddingLeft: pt(Math.max(0, e.bulletIndentPt)),
      }}
    >
      <span style={{ flexShrink: 0, width: pt(glyphBox) }}>{e.bulletChar}</span>
      <span style={{ ...PROSE, flex: 1, minWidth: 0, textAlign: design.font.textAlign }}>{children}</span>
    </li>
  );
}

function Bullets({ design, bullets, links }: { design: DesignSpec; bullets: string[]; links: EntryLink[] }) {
  if (!bullets.length && !links.length) return null;
  return (
    <ul style={{ listStyle: 'none', margin: `${pt(design.entry.bulletsTopPt)} 0 0 0`, padding: 0 }}>
      {bullets.map((text, i) => (
        <BulletRow key={i} design={design} last={i === bullets.length - 1 && links.length === 0}>
          {text}
        </BulletRow>
      ))}
      {links.length > 0 && (
        <BulletRow design={design} last role="links">
          <span style={{ textAlign: 'left', display: 'block' }}>
            <EntryLinks design={design} links={links} />
          </span>
        </BulletRow>
      )}
    </ul>
  );
}

// ---------------------------------------------------------------------------

/** Skills as page blocks: one per line (or grid row) where lines are separable. */
function skillBlocks(design: DesignSpec, groups: RenderedSkillGroup[]): ReactNode[] {
  const s = design.skills;
  const live = groups.filter((g) => g.skills.length > 0);
  if (!live.length) return [];
  const gap = (i: number, n: number) => ({ marginBottom: i === n - 1 ? 0 : pt(s.lineGapPt) });

  if (s.layout === 'comma-list') {
    return [
      <div key="all" data-role="skill">
        {live.flatMap((g) => g.skills).join(s.separator)}
      </div>,
    ];
  }

  if (s.layout === 'pills') {
    return [
      <div key="all" data-role="skill" style={{ display: 'flex', flexWrap: 'wrap', gap: pt(4) }}>
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
      </div>,
    ];
  }

  const label = (g: RenderedSkillGroup) =>
    g.category && <span style={{ fontWeight: s.categoryWeight }}>{g.category.replace(/:?\s*$/, ':')} </span>;

  // `columns`: a grid of category blocks, each a heading line then either
  // one comma-separated line or one bullet per item. One grid row per block.
  if (s.layout === 'columns') {
    const cols = Math.max(1, Math.round(s.columns));
    const rows: RenderedSkillGroup[][] = [];
    for (let i = 0; i < live.length; i += cols) rows.push(live.slice(i, i + cols));
    return rows.map((row, r) => (
      <div
        key={r}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          columnGap: pt(s.columnGapPt),
          ...gap(r, rows.length),
        }}
      >
        {row.map((g, i) => (
          <div key={i}>
            {g.category && (
              <div data-role="skill" style={{ fontWeight: s.categoryWeight }}>
                {g.category}
              </div>
            )}
            {g.list ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {g.skills.map((skill, k) => (
                  <BulletRow key={k} design={design} last={k === g.skills.length - 1}>
                    {skill}
                  </BulletRow>
                ))}
              </ul>
            ) : (
              <div data-role="skill">{g.skills.join(s.separator)}</div>
            )}
          </div>
        ))}
      </div>
    ));
  }

  if (s.layout === 'bullets') {
    return live.map((g, i) => (
      <ul key={i} style={{ listStyle: 'none', margin: 0, padding: 0, ...gap(i, live.length) }}>
        <BulletRow design={design} last role="skill">
          {label(g)}
          {g.skills.join(s.separator)}
        </BulletRow>
      </ul>
    ));
  }

  return live.map((g, i) => (
    <div key={i} data-role="skill" style={gap(i, live.length)}>
      {label(g)}
      <span>{g.skills.join(s.separator)}</span>
    </div>
  ));
}
