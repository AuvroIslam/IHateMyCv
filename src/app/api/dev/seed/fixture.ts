import type { CareerLibrary, DesignSpec } from '@/types/cv';

/**
 * A realistic single-column, LaTeX-styled engineering CV. Shaped exactly like
 * real extractor output (nulls and all) so it exercises the same code paths.
 */
export const DEMO_EXTRACTION = {
  design: {
    page: { size: 'a4', marginTop: 14, marginRight: 15, marginBottom: 14, marginLeft: 15 },
    font: { bodyFamily: 'times', headingFamily: 'times', baseSizePt: 9.8, lineHeight: 1.25 },
    color: {
      text: '#000000',
      heading: '#000000',
      accent: '#000000',
      muted: '#333333',
      rule: '#000000',
    },
    header: {
      align: 'center',
      nameSizePt: 22,
      nameWeight: 700,
      nameTransform: 'none',
      nameLetterSpacingEm: 0.01,
      nameColor: '#000000',
      headlineShown: false,
      headlineSizePt: 10,
      headlineStyle: 'italic',
      contactSizePt: 9.2,
      contactSeparator: ' | ',
      contactLayout: 'inline',
      ruleBelow: false,
      spaceBelowPt: 8,
    },
    sectionHeading: {
      sizePt: 11,
      weight: 700,
      transform: 'uppercase',
      letterSpacingEm: 0.04,
      align: 'left',
      style: 'rule-after',
      color: '#000000',
      spaceBeforePt: 9,
      spaceAfterPt: 4,
      rulePt: 0.8,
    },
    entry: {
      titleSizePt: 10.2,
      titleWeight: 700,
      subtitleStyle: 'italic',
      subtitleSizePt: 9.8,
      dateAlign: 'right',
      dateStyle: 'normal',
      dateSizePt: 9.5,
      layout: 'title-left-date-right',
      bulletChar: '•',
      bulletIndentPt: 9,
      bulletSizePt: 9.6,
      bulletSpacingPt: 1.5,
      spacingPt: 6,
    },
    skills: { layout: 'inline-categories', categoryWeight: 700, separator: ', ' },
    layout: { type: 'single', sideColumn: 'right', sideWidthPct: 32 },
    sections: [
      { id: 'education', title: 'EDUCATION', type: 'education', column: 'main' },
      { id: 'experience', title: 'EXPERIENCE', type: 'experience', column: 'main' },
      { id: 'projects', title: 'PROJECTS', type: 'projects', column: 'main' },
      { id: 'skills', title: 'TECHNICAL SKILLS', type: 'skills', column: 'main' },
      { id: 'achievements', title: 'ACHIEVEMENTS', type: 'achievements', column: 'main' },
    ],
  },
  personal: {
    fullName: 'Ayesha Rahman',
    headline: null,
    email: 'ayesha.rahman@example.com',
    phone: '+880 1700 000000',
    location: 'Dhaka, Bangladesh',
    links: [
      { label: 'github.com/ayesha-r', value: 'github.com/ayesha-r', href: null },
      { label: 'linkedin.com/in/ayesha-r', value: 'linkedin.com/in/ayesha-r', href: null },
    ],
  },
  summary: null,
  entries: [
    {
      sectionId: 'education',
      title: 'B.Sc. in Computer Science and Engineering',
      subtitle: 'Bangladesh University of Engineering and Technology',
      location: 'Dhaka',
      dateText: '2020 – 2024',
      sortDate: '2024-06',
      link: null,
      bullets: [
        { text: 'CGPA 3.81/4.00. Coursework: Distributed Systems, Databases, Machine Learning.', tags: ['databases', 'distributed systems', 'machine learning'] },
      ],
      tags: ['computer science', 'engineering', 'degree'],
    },
    {
      sectionId: 'experience',
      title: 'Backend Engineering Intern',
      subtitle: 'Shopfront Technologies',
      location: 'Remote',
      dateText: 'Jun 2023 – Sep 2023',
      sortDate: '2023-09',
      link: null,
      bullets: [
        { text: 'Rebuilt the order-ingestion pipeline in Go, cutting p99 latency from 840ms to 190ms under peak load.', tags: ['go', 'performance', 'backend', 'latency'] },
        { text: 'Introduced idempotency keys across payment webhooks, eliminating a recurring class of duplicate-charge incidents.', tags: ['payments', 'idempotency', 'reliability', 'webhooks'] },
        { text: 'Wrote the load-test harness used to size the service before Black Friday traffic.', tags: ['load testing', 'capacity planning'] },
      ],
      tags: ['backend', 'go', 'distributed systems', 'payments', 'internship'],
    },
    {
      sectionId: 'experience',
      title: 'Undergraduate Research Assistant',
      subtitle: 'BUET Systems Lab',
      location: 'Dhaka',
      dateText: 'Jan 2023 – May 2023',
      sortDate: '2023-05',
      link: null,
      bullets: [
        { text: 'Benchmarked consensus latency across Raft implementations on a 9-node cluster.', tags: ['raft', 'consensus', 'distributed systems', 'benchmarking'] },
        { text: 'Co-authored a workshop paper on write-amplification in LSM-tree stores.', tags: ['research', 'storage', 'lsm-tree', 'writing'] },
      ],
      tags: ['research', 'distributed systems', 'storage'],
    },
    {
      sectionId: 'experience',
      title: 'Frontend Developer (Part-time)',
      subtitle: 'Campus Media Collective',
      location: 'Dhaka',
      dateText: 'Sep 2022 – Dec 2022',
      sortDate: '2022-12',
      link: null,
      bullets: [
        { text: 'Built a React component library adopted by four student publications.', tags: ['react', 'frontend', 'design systems'] },
        { text: 'Cut Largest Contentful Paint by 45% through route-level code splitting.', tags: ['performance', 'frontend', 'web vitals'] },
      ],
      tags: ['frontend', 'react', 'typescript'],
    },
    {
      sectionId: 'projects',
      title: 'Ledgerline',
      subtitle: 'Go, PostgreSQL, Kafka',
      location: null,
      dateText: '2024',
      sortDate: '2024-03',
      link: 'https://github.com/ayesha-r/ledgerline',
      bullets: [
        { text: 'Double-entry accounting service processing 12k events/sec with exactly-once semantics over Kafka.', tags: ['kafka', 'go', 'event streaming', 'throughput'] },
        { text: 'Designed the partition strategy and the reconciliation job that proves ledger integrity nightly.', tags: ['postgresql', 'data integrity', 'system design'] },
      ],
      tags: ['backend', 'go', 'kafka', 'postgresql', 'fintech'],
    },
    {
      sectionId: 'projects',
      title: 'Kestrel',
      subtitle: 'Rust, gRPC',
      location: null,
      dateText: '2023',
      sortDate: '2023-11',
      link: null,
      bullets: [
        { text: 'Toy key-value store with an LSM storage engine and a Raft replication layer across 5 nodes.', tags: ['rust', 'raft', 'lsm-tree', 'storage', 'distributed systems'] },
        { text: 'Property-based test suite that surfaced three linearizability violations before release.', tags: ['testing', 'correctness', 'property-based testing'] },
      ],
      tags: ['systems', 'rust', 'distributed systems', 'storage'],
    },
    {
      sectionId: 'projects',
      title: 'Palette',
      subtitle: 'TypeScript, React, WebGL',
      location: null,
      dateText: '2022',
      sortDate: '2022-08',
      link: null,
      bullets: [
        { text: 'Browser-based colour grading tool with a WebGL pipeline handling 4K frames at 60fps.', tags: ['webgl', 'graphics', 'typescript', 'frontend'] },
        { text: 'Reached 1,200 weekly users with no backend — everything runs client-side.', tags: ['product', 'frontend'] },
      ],
      tags: ['frontend', 'graphics', 'typescript', 'react'],
    },
    {
      sectionId: 'achievements',
      title: 'ICPC Asia Dhaka Regional — 11th place',
      subtitle: 'ACM ICPC',
      location: null,
      dateText: '2022',
      sortDate: '2022-11',
      link: null,
      bullets: [{ text: 'Team of three, out of 120 competing teams.', tags: ['algorithms', 'competitive programming'] }],
      tags: ['algorithms', 'competitive programming', 'award'],
    },
    {
      sectionId: 'achievements',
      title: 'Dean’s List',
      subtitle: 'BUET',
      location: null,
      dateText: '2021, 2022, 2023',
      sortDate: '2023-12',
      link: null,
      bullets: [{ text: 'Awarded for academic standing in the top 5% of the cohort.', tags: ['academics'] }],
      tags: ['academics', 'award'],
    },
  ],
  skillGroups: [
    { sectionId: 'skills', category: 'Languages', skills: ['Go', 'Rust', 'TypeScript', 'Python', 'SQL', 'C++'] },
    { sectionId: 'skills', category: 'Infrastructure', skills: ['PostgreSQL', 'Kafka', 'Redis', 'Docker', 'Kubernetes', 'gRPC'] },
    { sectionId: 'skills', category: 'Frontend', skills: ['React', 'Next.js', 'WebGL', 'Tailwind CSS'] },
  ],
  pageCount: 1,
} as const;

/**
 * A plan of the kind the tailoring model produces for a backend role: promotes
 * the backend work, drops the frontend material, and reorders skills.
 */
export function demoTailorPlan(library: CareerLibrary, design: DesignSpec) {
  const find = (title: string) => library.entries.find((e) => e.title === title);
  const group = (category: string) => library.skillGroups.find((g) => g.category === category);

  const backendIntern = find('Backend Engineering Intern');
  const research = find('Undergraduate Research Assistant');
  const ledgerline = find('Ledgerline');
  const kestrel = find('Kestrel');
  const degree = find('B.Sc. in Computer Science and Engineering');
  const icpc = find('ICPC Asia Dhaka Regional — 11th place');

  const sectionIds = new Set(design.sections.map((s) => s.id));
  const ids = (...entries: (typeof backendIntern)[]) =>
    entries.filter(Boolean).map((e) => e!.id);

  return {
    roleTitle: 'Backend Engineer',
    company: 'Northwind',
    matchScore: 82,
    headline: null,
    summaryId: null,
    keywords: [
      { keyword: 'Go', covered: true, evidence: 'Shopfront internship and Ledgerline' },
      { keyword: 'distributed systems', covered: true, evidence: 'Kestrel Raft layer, BUET Systems Lab' },
      { keyword: 'event streaming', covered: true, evidence: 'Ledgerline (Kafka, exactly-once)' },
      { keyword: 'PostgreSQL', covered: true, evidence: 'Ledgerline partition strategy' },
      { keyword: 'Kubernetes in production', covered: false, evidence: null },
      { keyword: 'on-call ownership', covered: false, evidence: null },
    ],
    sections: [
      ...(sectionIds.has('education')
        ? [{ sectionId: 'education', entryIds: ids(degree), skillGroups: [] }]
        : []),
      { sectionId: 'experience', entryIds: ids(backendIntern, research), skillGroups: [] },
      { sectionId: 'projects', entryIds: ids(ledgerline, kestrel), skillGroups: [] },
      {
        sectionId: 'skills',
        entryIds: [],
        skillGroups: [
          { groupId: group('Languages')?.id ?? '', skills: ['Go', 'Rust', 'SQL', 'Python', 'TypeScript'] },
          {
            groupId: group('Infrastructure')?.id ?? '',
            skills: ['PostgreSQL', 'Kafka', 'gRPC', 'Redis', 'Docker', 'Kubernetes'],
          },
        ],
      },
      { sectionId: 'achievements', entryIds: ids(icpc), skillGroups: [] },
    ],
    bulletSelection: [
      ...(backendIntern
        ? [{ entryId: backendIntern.id, bulletIds: backendIntern.bullets.slice(0, 2).map((b) => b.id) }]
        : []),
      ...(research ? [{ entryId: research.id, bulletIds: [research.bullets[0].id] }] : []),
      ...(ledgerline ? [{ entryId: ledgerline.id, bulletIds: ledgerline.bullets.map((b) => b.id) }] : []),
      ...(kestrel ? [{ entryId: kestrel.id, bulletIds: [kestrel.bullets[0].id] }] : []),
    ],
    gaps: [
      'No production Kubernetes ownership — the posting asks for it explicitly.',
      'No on-call or incident-response experience on the CV.',
    ],
    rationale:
      'The posting leads on Go, event streaming and distributed storage, so Ledgerline and the Shopfront internship lead. The frontend work and Palette were dropped: strong material, but it argues for a different job.',
  };
}
