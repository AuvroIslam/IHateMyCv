import Link from 'next/link';
import { SITE } from '@/lib/site';

const LINKS = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/refunds', label: 'Refunds' },
];

export default function Footer() {
  return (
    <footer className="no-print border-t border-line">
      <div className="mx-auto flex max-w-[1760px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-5 text-xs text-subtle sm:px-5">
        <span>© {new Date().getFullYear()} {SITE.name}</span>
        <nav className="flex flex-wrap gap-x-4 gap-y-1">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        {SITE.support && (
          <a href={`mailto:${SITE.support}`} className="hover:text-foreground sm:ml-auto">
            {SITE.support}
          </a>
        )}
      </div>
    </footer>
  );
}
