'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOutEverywhere } from '@/lib/firebase-client';
import { PLANS } from '@/lib/plans';
import { useApp } from './AppProvider';
import { cx } from './ui/kit';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/profile', label: 'My Info' },
  { href: '/tailor', label: 'Tailor a CV' },
  { href: '/cvs', label: 'My CVs' },
];

export default function Nav() {
  const pathname = usePathname();
  const { hasApiKey, loading, signIn, account, plan } = useApp();
  // Signed out (the login page): no app links to offer.
  const signedOut = Boolean(signIn && !account);

  return (
    <header className="no-print sticky top-0 z-20 border-b border-line bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1760px] items-center gap-3 px-4 py-3 sm:gap-6 sm:px-5">
        <Link href="/" className="shrink-0 font-semibold tracking-tight whitespace-nowrap">
          I Hate My CV
        </Link>

        <nav className={cx('-mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1 text-sm', signedOut && 'hidden')}>
          {LINKS.map((link) => {
            // A single CV, and the chat shortcut that opens one, belong to My CVs.
            const active =
              link.href === '/'
                ? pathname === '/'
                : pathname.startsWith(link.href) ||
                  (link.href === '/cvs' && (pathname.startsWith('/cv/') || pathname === '/chat'));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cx(
                  'shrink-0 rounded-md px-2.5 py-1.5 whitespace-nowrap transition-colors',
                  active ? 'bg-foreground/8 text-foreground' : 'text-subtle hover:text-foreground',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-subtle">
          {!loading && !hasApiKey && (
            <span className="rounded bg-amber-500/15 px-2 py-1 text-amber-700 dark:text-amber-400">
              No API key
            </span>
          )}
          <Link
            href="/pricing"
            className={cx('rounded-md px-2 py-1 whitespace-nowrap hover:text-foreground', pathname === '/pricing' && 'text-foreground')}
          >
            {signedOut ? 'Pricing' : `${PLANS[plan.id].name} plan`}
          </Link>
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
