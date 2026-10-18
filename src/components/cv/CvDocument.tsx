import type { CSSProperties, ReactNode } from 'react';
import { embeddedPrefix } from '@/lib/embedded-fonts';
import { locksText, splitParagraphs, squash } from '@/lib/line-lock';
import { fontStack } from '@/lib/fonts';
import type {
  LinkLook,
  CvDocumentData,
  DesignSpec,
  EntryLink,
  LockedLines,
  RenderedEntry,
  RenderedSection,
  RenderedSkillGroup,
  HeaderField,
  HeaderTemplate,
  HeadingField,
  HeadingPart,
  HeadingTemplate,
  SectionDef,
  SectionSpacing,
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
    wordSpacing: design.font.wordSpacingPt ? pt(design.font.wordSpacingPt) : undefined,
    letterSpacing: design.font.letterSpacingEm ? `${design.font.letterSpacingEm}em` : undefined,
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
    // Read by the continuation-page rule in globals.css.
    ['--cv-continuation-top' as string]: pt(design.page.continuationTopPt ?? 0),
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


export interface Block {
  key: string;
  node: ReactNode;
  /** Never end a page on this block (section headings). */
  keepWithNext: boolean;
  /** Two-column CVs: the header spans the page, sections sit in a column. */
  column: 'full' | 'main' | 'side';
  /**
   * Everything the block prints, as plain values: two blocks with the same
   * content print the same. Lets the replica redraw a block that tailoring
   * left untouched straight from the original PDF.
   */
  content: unknown[];
  /** The section it belongs to; none for the header. */
  section?: string;
}

/** A two-column CV with something actually in its side column. */
export function isTwoColumn(design: DesignSpec, data: CvDocumentData): boolean {
  return design.layout.type === 'two-column' && visibleSections(design, data, 'side').length > 0;
}

/** Column widths in mm: side column, gap, main column. */
export function columnWidthsMm(design: DesignSpec) {
  const total = contentWidthMm(design);
  const side = (total * design.layout.sideWidthPct) / 100;
  const gap = 18 * (25.4 / 72);
  return { side, gap, main: total - side - gap };
}

export function buildBlocks(design: DesignSpec, data: CvDocumentData): Block[] {
  const twoCol = isTwoColumn(design, data);
  const p = data.personal;
  const blocks: Block[] = [
    {
      key: 'header',
      node: <Header design={design} data={data} />,
      keepWithNext: false,
      column: twoCol ? 'full' : 'main',
      content: [p.fullName, p.headline, p.email, p.phone, p.location, p.links.map((l) => [l.label, l.value])],
    },
  ];

  const sections = [
    ...visibleSections(design, data, 'main').map((x) => ({ ...x, column: 'main' as const })),
    ...visibleSections(design, data, 'side').map((x) => ({ ...x, column: twoCol ? ('side' as const) : ('main' as const) })),
  ];
  // A left gutter (moderncv): every section sits in the content column; the
  // gutter holds only what entries hang into it.
  const gutter = !twoCol && design.layout.gutterPt ? design.layout.gutterPt : 0;
  for (const { def, section, column } of sections) {
    const push = (b: Omit<Block, 'column' | 'section'>) =>
      blocks.push({
        ...b,
        column,
        section: def.id,
        node: gutter ? <div style={{ paddingLeft: pt(gutter) }}>{b.node}</div> : b.node,
      });
    push({
      key: `${def.id}:heading`,
      content: [section.title ?? def.title],
      node: <SectionHeading
          design={design}
          title={section.title ?? def.title}
          topPt={def.spacing?.headingTopPt}
          ruleGapPt={def.spacing?.ruleGapPt}
        />,
      keepWithNext: true,
    });

    if (def.type === 'summary') {
      push({
        key: `${def.id}:summary`,
        content: [section.summary?.trim() ?? ''],
        node: (
          <Paragraph
            design={design}
            text={section.summary ?? ''}
            lines={section.summaryLines}
            paragraphs={section.summaryParagraphs}
            gapPt={def.spacing?.entryGapPt ?? design.entry.spacingPt}
            align={def.textAlign}
          />
        ),
        keepWithNext: false,
      });
    } else if (def.type === 'skills') {
      // Which groups land in which block depends on the layout, so each block
      // stands for the whole set: any change redraws them all.
      const groups = section.skillGroups.map((g) => [g.category, g.skills]);
      skillBlocks(design, section.skillGroups).forEach((node, i) =>
        push({ key: `${def.id}:skills:${i}`, node, keepWithNext: false, content: [i, groups] }),
      );
    } else {
      section.entries.forEach((entry, i) => {
        if (startsGroup(section.entries, i)) {
          push({
            key: `${def.id}:group:${i}`,
            content: [entry.group, i === 0],
            node: <GroupLabel design={design} label={entry.group!} first={i === 0} />,
            keepWithNext: true,
          });
        }
        const last = i === section.entries.length - 1;
        push({
          key: `${def.id}:${entry.entryId ?? i}`,
          content: [
            entryContent(entry),
            last,
            def.mergeRepeats && section.entries[i - 1] ? entryContent(section.entries[i - 1]) : null,
          ],
          node: (
            <Entry
              design={design}
              entry={entry}
              isLast={last}
              layout={def.entryLayout}
              joiner={def.titleJoiner}
              spacing={def.spacing}
              template={def.heading}
              previous={def.mergeRepeats ? section.entries[i - 1] : undefined}
              numbered={def.numbered}
              linksAfter={def.linksAfter}
            />
          ),
          keepWithNext: false,
        });
      });
    }
  }
  return blocks;
}

function entryContent(e: RenderedEntry): unknown[] {
  return [e.title, e.subtitle, e.location, e.dateText, e.note, e.link, (e.links ?? []).map((l) => [l.label, l.url]), e.bullets];
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

  const twoColumn = isTwoColumn(design, data);

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
      <SectionHeading
          design={design}
          title={section.title ?? def.title}
          topPt={def.spacing?.headingTopPt}
          ruleGapPt={def.spacing?.ruleGapPt}
        />
      {def.type === 'summary' && (
        <Paragraph
          design={design}
          text={section.summary ?? ''}
          lines={section.summaryLines}
          paragraphs={section.summaryParagraphs}
          gapPt={def.spacing?.entryGapPt ?? design.entry.spacingPt}
            align={def.textAlign}
        />
      )}
      {def.type === 'skills' && skillBlocks(design, section.skillGroups)}
      {def.type !== 'summary' &&
        def.type !== 'skills' &&
        section.entries.map((entry, i) => (
          <div key={entry.entryId ?? `${def.id}-${i}`}>
            {startsGroup(section.entries, i) && <GroupLabel design={design} label={entry.group!} first={i === 0} />}
            <Entry
              design={design}
              entry={entry}
              isLast={i === section.entries.length - 1}
              layout={def.entryLayout}
              joiner={def.titleJoiner}
              spacing={def.spacing}
              template={def.heading}
              previous={def.mergeRepeats ? section.entries[i - 1] : undefined}
              numbered={def.numbered}
              linksAfter={def.linksAfter}
            />
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

function Link({
  design,
  href,
  look,
  children,
}: {
  design: DesignSpec;
  href?: string;
  /** How the original printed this kind of link. */
  look?: LinkLook;
  children: ReactNode;
}) {
  const style: CSSProperties = {
    color: look?.color ?? design.color.link,
    textDecoration: look?.underline ? 'underline' : 'none',
    textUnderlineOffset: look?.underline ? '0.12em' : undefined,
    fontWeight: look?.bold ? 700 : undefined,
  };
  if (!href) return <span style={look ? style : undefined}>{children}</span>;
  return (
    <a href={href} style={style}>
      {children}
    </a>
  );
}

/**
 * `pretty` wrapping weighs the whole paragraph instead of filling greedily,
 * which lands much closer to TeX's line breaks.
 */
const PROSE: CSSProperties = { textWrap: 'pretty' };

function Paragraph({
  design,
  text,
  lines,
  paragraphs,
  gapPt,
  align,
}: {
  design: DesignSpec;
  text: string;
  lines?: LockedLines;
  /** Locked lines per paragraph, for a summary of several. */
  paragraphs?: (LockedLines | null)[];
  /** Space between paragraphs. */
  gapPt: number;
  /** The section's own alignment, when it differs from the design's. */
  align?: 'left' | 'justify';
}) {
  const textAlign = align ?? design.font.textAlign;
  const paras = splitParagraphs(text);
  if (paras.length <= 1) {
    return (
      <p data-role="summary" style={{ ...PROSE, margin: 0, textAlign }}>
        <LockedText design={design} text={text} lines={lines} align={textAlign} />
      </p>
    );
  }
  return (
    <>
      {paras.map((p, i) => (
        <p
          key={i}
          data-role="summary"
          style={{ ...PROSE, margin: 0, marginTop: i ? pt(gapPt) : 0, textAlign }}
        >
          <LockedText design={design} text={p} lines={paragraphs?.[i] ?? undefined} align={textAlign} />
        </p>
      ))}
    </>
  );
}

/**
 * Text set on the original's own line breaks when it is unchanged, so TeX's
 * hyphenation and tight spacing carry over exactly; otherwise normal wrapping.
 * Lines too wide for the browser's spacing are tightened by CvPreview.
 */
function LockedText({
  design,
  text,
  lines,
  boldPrefix,
  align,
}: {
  design: DesignSpec;
  text: string;
  lines?: LockedLines;
  boldPrefix?: string;
  /** The section's own alignment, when it differs from the design's. */
  align?: 'left' | 'justify';
}) {
  // A bold lead-in ("Current CGPA:") applies only while the text still starts with it.
  const lead = boldPrefix && text.startsWith(boldPrefix) ? boldPrefix : '';
  const withLead = (s: string, first: boolean) =>
    first && lead && s.startsWith(lead) ? (
      <>
        <b style={{ fontWeight: design.entry.titleWeight }}>{lead}</b>
        {s.slice(lead.length)}
      </>
    ) : (
      s
    );
  if (!locksText(text, lines)) return <>{withLead(text, true)}</>;
  const justify = (align ?? design.font.textAlign) === 'justify';
  return (
    <>
      {lines.lines.map((line, i) => {
        const stretch = justify && i < lines.lines.length - 1;
        return (
          <span
            key={i}
            className="cv-line"
            style={{
              display: 'block',
              whiteSpace: 'nowrap',
              textAlign: stretch ? 'justify' : 'left',
              textAlignLast: stretch ? 'justify' : 'auto',
            }}
          >
            {withLead(line, i === 0)}
          </span>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------

function Header({ design, data }: { design: DesignSpec; data: CvDocumentData }) {
  if (design.header.template) return <TemplateHeader design={design} data={data} template={design.header.template} />;
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


/**
 * The header as the original arranged it: rows of personal fields, each row
 * with a left, centre and right group. Covers centred blocks, a name with
 * contacts beside it, and split two-sided headers alike.
 */
function TemplateHeader({
  design,
  data,
  template,
}: {
  design: DesignSpec;
  data: CvDocumentData;
  template: HeaderTemplate;
}) {
  const h = design.header;
  const { personal } = data;

  const labelled = (label: string, value: ReactNode) => (
    <>
      {label && <span style={{ fontWeight: h.contactLabelWeight }}>{label} </span>}
      {value}
    </>
  );

  const nameStyle: CSSProperties = {
    fontFamily: embeddedPrefix(design, 'name') + fontStack(design.font.headingFamily),
    fontSize: pt(h.nameSizePt),
    fontWeight: h.nameWeight,
    textTransform: h.nameTransform === 'uppercase' ? 'uppercase' : 'none',
    letterSpacing: `${h.nameLetterSpacingEm}em`,
    color: h.nameColor,
    lineHeight: 1.15,
  };

  const nodeFor = (field: HeaderField): ReactNode => {
    if (field === 'name') {
      return (
        <span data-role="name" style={nameStyle}>
          {personal.fullName}
        </span>
      );
    }
    if (field === 'headline') {
      return personal.headline ? (
        <span style={{ fontSize: pt(h.headlineSizePt), fontStyle: h.headlineStyle }}>{personal.headline}</span>
      ) : null;
    }
    if (field === 'email') {
      return personal.email
        ? labelled(
            h.contactLabels.email,
            <Link design={design} href={`mailto:${personal.email}`}>
              {personal.email}
            </Link>,
          )
        : null;
    }
    if (field.startsWith('text:')) return template.literals?.[Number(field.split(':')[1])] ?? null;
    if (field === 'phone') return personal.phone ? labelled(h.contactLabels.phone, personal.phone) : null;
    if (field === 'location') return personal.location ? labelled(h.contactLabels.location, personal.location) : null;
    const link = personal.links[Number(field.split(':')[1])];
    return link?.label ? (
      <Link design={design} href={link.href} look={h.linkLook}>
        {link.label}
      </Link>
    ) : null;
  };

  const group = (parts: HeadingPart<HeaderField>[]) =>
    parts
      .map((part) => ({ part, node: nodeFor(part.field) }))
      .filter((x) => x.node)
      .map(({ part, node }, i) => {
        const glyph = part.joiner.trim();
        return (
          <span key={part.field}>
            {i > 0 &&
              (part.gapPt != null && !glyph ? (
                <span style={{ display: 'inline-block', width: pt(part.gapPt) }} />
              ) : glyph && h.contactGapPt != null ? (
                <Sep text={glyph} gapPt={h.contactGapPt} />
              ) : (
                <span style={{ whiteSpace: 'pre' }}>{part.joiner || ' '}</span>
              ))}
            {part.field === 'name' ? (
              node
            ) : (
              // Each part as the original printed it: a smaller italic
              // location, a bold phone number.
              <span
                style={{
                  fontSize: part.sizePt ? pt(part.sizePt) : undefined,
                  fontStyle: part.style.endsWith('italic') ? 'italic' : undefined,
                  fontWeight: part.style.startsWith('bold') ? 700 : undefined,
                }}
              >
                {node}
              </span>
            )}
          </span>
        );
      });

  return (
    <header
      style={{
        marginBottom: pt(h.spaceBelowPt),
        paddingBottom: h.ruleBelow ? pt(4) : undefined,
        borderBottom: h.ruleBelow ? `${design.sectionHeading.rulePt || 0.75}pt solid ${design.color.rule}` : undefined,
      }}
    >
      {template.rows.map((row, r) => {
        const left = group(row.left);
        const center = group(row.center);
        const right = group(row.right);
        if (!left.length && !center.length && !right.length) return null;
        const hasName = [...row.left, ...row.center, ...row.right].some((p) => p.field === 'name');
        const rowStyle: CSSProperties = {
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'baseline',
          fontSize: pt(h.contactSizePt),
          color: design.color.muted,
          marginTop: r === 0 ? 0 : pt((r === 1 ? h.contactTopPt : 0) + (row.topPt ?? 0)),
        };
        return (
          <div key={r} style={rowStyle} data-role={hasName ? undefined : 'contact'} data-row={r}>
            <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{left}</div>
            <div style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{center}</div>
            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{right}</div>
          </div>
        );
      })}
    </header>
  );
}

// ---------------------------------------------------------------------------

function SectionHeading({
  design,
  title,
  topPt,
  ruleGapPt,
}: {
  design: DesignSpec;
  title: string;
  topPt?: number;
  ruleGapPt?: number;
}) {
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
    marginTop: pt(topPt ?? s.spaceBeforePt),
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

  if (s.style === 'rule-before') {
    // The rule sits ruleGap above the heading's baseline; the baseline lies
    // about 0.95em below the top of a 1.2 line box.
    const gap = ruleGapPt ?? s.ruleGapPt ?? s.sizePt * 1.3;
    const rule = s.rulePt || 0.75;
    return (
      <div
        data-role="heading"
        style={{
          ...base,
          borderTop: `${rule}pt solid ${design.color.rule}`,
          paddingTop: pt(Math.max(0, gap - s.sizePt * 0.95 - rule / 2)),
        }}
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
          <Link design={design} href={l.url || undefined} look={design.entry.linkLook}>
            {l.label}
          </Link>
        </span>
      ))}
    </>
  );
}

function Entry({
  design,
  entry,
  isLast,
  layout: sectionLayout,
  joiner: sectionJoiner,
  spacing,
  template,
  previous,
  numbered,
  linksAfter,
}: {
  design: DesignSpec;
  entry: RenderedEntry;
  isLast: boolean;
  /** The section's own layout, when it differs from the design-wide one. */
  layout?: DesignSpec['entry']['layout'];
  joiner?: string;
  spacing?: SectionSpacing;
  /** The heading arrangement read from the original, when there is one. */
  template?: HeadingTemplate;
  /** The entry above, in sections that print a shared organisation once. */
  previous?: RenderedEntry;
  /** The section numbers its items instead of bulleting them. */
  numbered?: 'asc' | 'desc';
  /** Own-line links print after the bullets rather than under the heading. */
  linksAfter?: boolean;
}) {
  // Section-fitted gaps override the design-wide ones.
  const e = {
    ...design.entry,
    spacingPt: spacing?.entryGapPt ?? design.entry.spacingPt,
    bulletsTopPt: spacing?.bulletsTopPt ?? design.entry.bulletsTopPt,
    subtitleGapPt: spacing?.subtitleGapPt ?? design.entry.subtitleGapPt,
    bulletSpacingPt: spacing?.bulletGapPt ?? design.entry.bulletSpacingPt,
    indentPt: spacing?.entryIndentPt ?? design.entry.indentPt,
  };
  const layout = sectionLayout ?? e.layout;
  const joiner = sectionJoiner ?? e.titleJoiner;
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

  // Tagged for a CV's own title colour (see cv-style.ts).
  const titleNode = (
    <span data-role="entry-title">
      {entry.link ? (
        <a href={entry.link} style={{ color: 'inherit', textDecoration: 'none' }}>
          {entry.title}
        </a>
      ) : (
        entry.title
      )}
    </span>
  );

  const titleLinks =
    e.linksPlacement === 'title-line' && links.length > 0 ? (
      <span style={{ fontWeight: 'normal' }}>
        <Sep text={e.linkSeparator} gapPt={e.linkGapPt} />
        <EntryLinks design={design} links={links} />
      </span>
    ) : null;

  // On a line of their own: under the heading, or - where the original
  // prints them last (a DOI under the authors) - after the bullets.
  const linkLine = (topPt: number) =>
    e.linksPlacement === 'own-line' && links.length > 0 ? (
      <div data-role="links" style={{ marginTop: pt(topPt) }}>
        <EntryLinks design={design} links={links} />
      </div>
    ) : null;
  const ownLineLinks = linksAfter ? null : linkLine(e.subtitleGapPt);

  const bulletLinks = e.linksPlacement === 'bullet' && links.length > 0 ? links : [];
  const inlineDate = e.dateAlign === 'inline' && entry.dateText;
  const wrap: CSSProperties = {
    marginBottom: isLast ? 0 : pt(e.spacingPt),
    paddingLeft: e.indentPt ? pt(e.indentPt) : undefined,
  };
  const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' };
  const row2: CSSProperties = { ...row, marginTop: pt(e.subtitleGapPt) };
  const row1 = row;
  const bullets = (
    <>
      <Bullets
        design={design}
        bullets={entry.bullets}
        links={bulletLinks}
        print={entry.bulletPrint}
        gapPt={e.bulletSpacingPt}
        topPt={e.bulletsTopPt}
        numbered={numbered}
      />
      {linksAfter && linkLine(entry.bullets.length ? e.bulletSpacingPt : e.subtitleGapPt)}
    </>
  );

  // A headingless list (certifications, a bulleted summary): just the bullets.
  if (!entry.title && !entry.subtitle && !entry.dateText && !entry.location) {
    return (
      <div style={wrap}>
        {ownLineLinks}
        {bullets}
      </div>
    );
  }

  if (template) {
    const valueOf = (f: HeadingField): ReactNode =>
      f === 'title'
        ? entry.title
          ? titleNode
          : null
        : f === 'subtitle'
          ? entry.subtitle
          : f === 'location'
            ? entry.location
            : f === 'note'
              ? entry.note
              : entry.dateText;
    const styleOf = (part: HeadingPart): CSSProperties => ({
      fontSize: pt(part.sizePt ?? (part.field === 'title' ? e.titleSizePt : part.field === 'date' ? e.dateSizePt : e.subtitleSizePt)),
      fontWeight: part.style.startsWith('bold') ? e.titleWeight : 'normal',
      fontStyle: part.style.endsWith('italic') ? 'italic' : 'normal',
      color: part.field === 'date' || part.field === 'location' || part.field === 'note' ? design.color.muted : undefined,
    });
    const run = (parts: HeadingPart[]) =>
      parts
        .filter((part) => valueOf(part.field))
        .map((part, i) => (
          <span key={part.field}>
            {i > 0 && <span style={{ whiteSpace: 'pre' }}>{part.joiner}</span>}
            <span style={styleOf(part)}>{valueOf(part.field)}</span>
          </span>
        ));
    // A second role at the same organisation: its first row would only
    // repeat the one printed above it.
    const text = (x: RenderedEntry, f: HeadingField) =>
      (f === 'title' ? x.title : f === 'subtitle' ? x.subtitle : f === 'location' ? x.location : f === 'note' ? x.note : x.dateText)?.trim() ?? '';
    const first = template.rows[0] ? [...template.rows[0].left, ...template.rows[0].right] : [];
    const repeats =
      previous != null && template.rows.length > 1 && first.length > 0 && first.every((p) => text(entry, p.field) === text(previous, p.field));
    const rows = template.rows
      .slice(repeats ? 1 : 0)
      .map((row) => ({ left: run(row.left), right: run(row.right) }))
      .filter((row) => row.left.length || row.right.length);
    // Hung into the layout's left gutter, flush right against the content.
    const gutterParts = template.gutter ? run(template.gutter) : [];
    const hang =
      gutterParts.length > 0 ? (
        <span
          style={{
            position: 'absolute',
            right: `calc(100% + ${pt(design.layout.gutterGapPt ?? 8)})`,
            whiteSpace: 'nowrap',
            textAlign: 'right',
          }}
        >
          {gutterParts}
        </span>
      ) : null;

    // Later rows holding only right-hand fields (dates, location, duration)
    // form a column beside the bullets rather than lines above them.
    const aside = template.rows.length > 1 && template.rows.slice(1).every((r) => r.left.length === 0);
    if (aside && rows.length) {
      return (
        <div style={wrap}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={row1} data-role="title">
                <div style={{ minWidth: 0 }}>
                  {rows[0].left}
                  {titleLinks}
                </div>
              </div>
              {ownLineLinks}
              {bullets}
            </div>
            <div style={{ textAlign: 'right', whiteSpace: 'nowrap', paddingLeft: pt(8) }}>
              {rows.map((row, r) => (
                <div key={r} data-role={r === 0 ? undefined : 'subtitle'} style={r === 0 ? undefined : { marginTop: pt(e.subtitleGapPt) }}>
                  {row.right}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={wrap}>
        {rows.map((row, r) => (
          <div
            key={r}
            style={{ ...(r === 0 ? row1 : row2), ...(r === 0 && hang ? { position: 'relative' } : {}) }}
            data-role={r === 0 ? 'title' : 'subtitle'}
          >
            {r === 0 && hang}
            <div style={{ minWidth: 0 }}>
              {row.left}
              {r === 0 && titleLinks}
            </div>
            {row.right.length > 0 && <div style={{ whiteSpace: 'nowrap', paddingLeft: pt(8) }}>{row.right}</div>}
          </div>
        ))}
        {ownLineLinks}
        {bullets}
      </div>
    );
  }

  // `compact` collapses title, subtitle and date onto a single line.
  if (layout === 'compact') {
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

  // `org-title` / `title-org`: "Company – Role" or "Event - Organiser" in
  // title style on one line, date right, location alone underneath.
  if (layout === 'org-title' || layout === 'title-org') {
    const join = entry.subtitle ? <span style={{ whiteSpace: 'pre' }}>{joiner}</span> : null;
    return (
      <div style={wrap}>
        <div style={row} data-role="title">
          <div style={{ ...titleStyle, minWidth: 0 }}>
            {layout === 'org-title' ? (
              <>
                {entry.subtitle}
                {join}
                {titleNode}
              </>
            ) : (
              <>
                {titleNode}
                {join}
                {entry.subtitle}
              </>
            )}
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
  const swapped = layout === 'title-then-subtitle';
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
  gapPt,
  glyph,
  children,
}: {
  design: DesignSpec;
  last: boolean;
  role?: string;
  /** Gap below this row; defaults to the design-wide bullet gap. */
  gapPt?: number;
  /** In place of the design's bullet glyph: a list number ("2."). */
  glyph?: string;
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
        marginBottom: last ? 0 : pt(gapPt ?? e.bulletSpacingPt),
        paddingLeft: pt(Math.max(0, e.bulletIndentPt)),
      }}
    >
      <span style={{ flexShrink: 0, minWidth: pt(glyphBox), whiteSpace: 'nowrap', paddingRight: glyph ? '0.3em' : undefined }}>
        {glyph ?? e.bulletChar}
      </span>
      <span style={{ ...PROSE, flex: 1, minWidth: 0, textAlign: design.font.textAlign }}>{children}</span>
    </li>
  );
}

/** A table row: each cell starts at the original's tab stop; the last one wraps. */
function Cells({ cells, tabs }: { cells: string[]; tabs: number[] }) {
  const widths = tabs.slice(1).map((t, i) => pt(t - tabs[i]));
  return (
    <span style={{ display: 'grid', gridTemplateColumns: [...widths, 'minmax(0, 1fr)'].join(' ') }}>
      {cells.map((c, i) => (
        <span key={i} style={i < cells.length - 1 ? { whiteSpace: 'nowrap' } : undefined}>
          {c}
        </span>
      ))}
    </span>
  );
}

function Bullets({
  design,
  bullets,
  links,
  print,
  gapPt,
  topPt,
  numbered,
}: {
  design: DesignSpec;
  bullets: string[];
  links: EntryLink[];
  print?: RenderedEntry['bulletPrint'];
  gapPt: number;
  topPt: number;
  numbered?: 'asc' | 'desc';
}) {
  if (!bullets.length && !links.length) return null;
  return (
    <ul style={{ listStyle: 'none', margin: `${pt(topPt)} 0 0 0`, padding: 0 }}>
      {bullets.map((text, i) => {
        const last = i === bullets.length - 1 && links.length === 0;
        const p = print?.[text];
        const body =
          p?.cells && p.tabs && p.cells.join(' ') === squash(text) ? (
            <Cells cells={p.cells} tabs={p.tabs} />
          ) : (
            <LockedText design={design} text={text} lines={p?.lines} boldPrefix={p?.boldPrefix} />
          );
        // Some CVs print a detail line ("Current CGPA: 3.64") with no glyph.
        if (p?.plain && !numbered) {
          return (
            <li
              key={i}
              data-role="bullet"
              style={{ fontSize: pt(design.entry.bulletSizePt), marginBottom: last ? 0 : pt(gapPt) }}
            >
              {body}
            </li>
          );
        }
        return (
          <BulletRow
            key={i}
            design={design}
            last={last}
            gapPt={gapPt}
            glyph={numbered ? `${numbered === 'asc' ? i + 1 : bullets.length - i}.` : undefined}
          >
            {body}
          </BulletRow>
        );
      })}
      {links.length > 0 &&
        (design.entry.linkEach ? (
          links.map((l, i) => (
            <BulletRow key={`link-${i}`} design={design} last={i === links.length - 1} role="links" gapPt={gapPt}>
              <span style={{ textAlign: 'left', display: 'block' }}>
                <EntryLinks design={design} links={[l]} />
              </span>
            </BulletRow>
          ))
        ) : (
          <BulletRow design={design} last role="links" gapPt={gapPt}>
            <span style={{ textAlign: 'left', display: 'block' }}>
              <EntryLinks design={design} links={links} />
            </span>
          </BulletRow>
        ))}
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

  // Stacked groups print as the original did whatever the section's layout:
  // the category on its own line, then one line per item.
  if (live.some((g) => g.stacked)) {
    return live.flatMap((g, i) =>
      g.stacked
        ? [
            g.category && <GroupLabel key={`${i}-c`} design={design} label={g.category} first={i === 0} />,
            ...g.skills.map((skill, k) => (
              <div key={`${i}-${k}`} data-role="skill" style={gap(k, g.skills.length)}>
                {skill}
              </div>
            )),
          ].filter(Boolean)
        : [
            <div key={i} data-role="skill" style={gap(i, live.length)}>
              {label(g)}
              <span>{g.skills.join(s.separator)}</span>
            </div>,
          ],
    );
  }

  if (s.layout === 'table' && s.itemsAtPt) {
    const gutter = s.categoryGapPt ?? 6;
    return live.map((g, i) => (
      <div
        key={i}
        data-role="skill"
        style={{ display: 'grid', gridTemplateColumns: `${pt(s.itemsAtPt!)} minmax(0, 1fr)`, ...gap(i, live.length) }}
      >
        <span style={{ fontWeight: s.categoryWeight, textAlign: s.categoryAlign ?? 'right', paddingRight: pt(gutter) }}>
          {g.category.replace(/:\s*$/, '')}
        </span>
        <span>{g.skills.join(s.separator)}</span>
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
