'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOutEverywhere } from '@/lib/firebase-client';
import { useApp } from './AppProvider';
import { cx } from './ui/kit';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/library', label: 'Career Library' },
  { href: '/design', label: 'Design' },
  { href: '/tailor', label: 'Tailor' },
  { href: '/chat', label: 'Chat' },
  { href: '/cvs', label: 'My CVs' },
];

export default function Nav() {
  const pathname = usePathname();
  const { library, hasApiKey, loading, signIn, account } = useApp();
  // Signed out (the login page): no app links to offer.
  const signedOut = Boolean(signIn && !account);

  return (
    <header className="no-print sticky top-0 z-20 border-b border-line bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1760px] items-center gap-6 px-5 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          I Hate My CV
        </Link>

        <nav className={cx('flex items-center gap-1 text-sm', signedOut && 'hidden')}>
          {LINKS.map((link) => {
            const active =
              link.href === '/'
                ? pathname === '/'
                : pathname.startsWith(link.href) || (link.href === '/chat' && pathname.startsWith('/cv/'));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cx(
                  'rounded-md px-2.5 py-1.5 transition-colors',
                  active ? 'bg-foreground/8 text-foreground' : 'text-subtle hover:text-foreground',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-xs text-subtle">
          {!loading && !hasApiKey && (
            <span className="rounded bg-amber-500/15 px-2 py-1 text-amber-700 dark:text-amber-400">
              No API key
            </span>
          )}
          {library && !signedOut && (
            <Link href="/upload" className="hover:text-foreground">
              Replace CV
            </Link>
          )}
          {account && (
            <>
              <span className="hidden max-w-[16rem] truncate sm:inline" title={account.email}>
                {account.email ?? account.name}
              </span>
              <button onClick={() => void signOutEverywhere()} className="hover:text-foreground">
                Sign out
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
