'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Badge, Button, ErrorNote, LocalDate, Panel, Spinner, cx } from '@/components/ui/kit';
import { type BillingInfo, api } from '@/lib/client-api';
import { PLANS, PLAN_ORDER, type PlanId, USAGE_LABEL, type UsageKind } from '@/lib/plans';

const KINDS: UsageKind[] = ['tailor', 'chat', 'upload', 'import'];

/** Every plan gets these; the plans differ only in how much a month. */
const EVERY_PLAN = ['Your CV reproduced exactly, in its own design', 'Edit by chat or by hand, with rewind', 'Job match report and PDF export'];

/** The plans, the one in use and what is left of it this month. */
export default function PricingPage({ searchParams }: PageProps<'/pricing'>) {
  const { paid } = use(searchParams);
  const { signIn, account, plan, refresh } = useApp();
  const signedOut = Boolean(signIn && !account);
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await api.billing();
    setInfo(next);
    return next;
  }, []);

  useEffect(() => {
    if (signedOut) return;
    api.billing().then(setInfo, (err) => setError(err instanceof Error ? err.message : 'Could not load your plan.'));
  }, [signedOut]);

  // Back from checkout: the plan changes when Lemon Squeezy's webhook lands, usually within seconds.
  const waiting = Boolean(paid) && !signedOut && (info?.plan ?? plan.id) === 'free';
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const next = await load().catch(() => null);
      if ((next && next.plan !== 'free') || tries >= 20) {
        clearInterval(timer);
        void refresh();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [waiting, load, refresh]);

  const go = async (key: string, fn: () => Promise<{ url: string }>) => {
    setBusy(key);
    setError(null);
    try {
      window.location.assign((await fn()).url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(null);
    }
  };

  const current = info?.plan ?? plan.id;
  const sub = info?.subscription;
  const payments = info?.payments ?? true;

  const action = (id: PlanId) => {
    if (signedOut) {
      return (
        <Link href={id === 'free' ? '/login' : '/login?next=/pricing'} className="block">
          <Button variant={id === 'pro' ? 'primary' : 'secondary'} className="w-full">
            {id === 'free' ? 'Start free' : `Sign in to get ${PLANS[id].name}`}
          </Button>
        </Link>
      );
    }
    if (id === current) {
      return (
        <Button disabled className="w-full">
          Your plan
        </Button>
      );
    }
    if (id === 'free') {
      return current === 'free' ? null : <p className="text-center text-xs text-subtle">Cancel in Manage subscription</p>;
    }
    const upgrade = PLANS[id].price > PLANS[current].price;
    return (
      <Button
        variant={upgrade ? 'primary' : 'secondary'}
        className="w-full"
        disabled={!payments || busy !== null || !info}
        onClick={() => void go(id, () => api.checkout(id))}
      >
        {busy === id && <Spinner />}
        {current === 'free' ? `Get ${PLANS[id].name}` : upgrade ? `Upgrade to ${PLANS[id].name}` : `Switch to ${PLANS[id].name}`}
      </Button>
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Pricing</h1>
      <p className="mt-1 text-sm text-subtle">
        Monthly plans in US dollars. Cancel any time. Local tax is added at checkout where it applies.
      </p>

      {paid && !signedOut && (
        <p className="mt-4 rounded-md border border-emerald-600/30 bg-emerald-600/8 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          {waiting ? (
            <>
              <Spinner className="mr-2" /> Thanks! Your payment went through. Your plan updates in a moment…
            </>
          ) : (
            <>Thanks! You are on {PLANS[current].name} now.</>
          )}
        </p>
      )}
      {!payments && current === 'free' && (
        <p className="mt-4 rounded-md border border-line bg-panel px-3 py-2 text-sm text-subtle">
          Paid plans open soon. Everything on Free works today.
        </p>
      )}
      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id];
          return (
            <Panel key={id} className={cx('flex flex-col p-5', id === 'pro' && 'border-foreground/40')}>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{p.name}</h2>
                {id === 'pro' && <Badge tone="good">Most popular</Badge>}
                {!signedOut && id === current && <Badge>Current</Badge>}
              </div>
              <p className="mt-1 text-sm text-subtle">{p.blurb}</p>
              <p className="mt-4">
                <span className="text-3xl font-semibold">${p.price}</span>
                <span className="text-sm text-subtle"> / month</span>
              </p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                {KINDS.map((k) => (
                  <li key={k}>
                    <strong>{p.monthly[k]}</strong> {p.monthly[k] === 1 ? USAGE_LABEL[k].one : USAGE_LABEL[k].many}
                  </li>
                ))}
                {EVERY_PLAN.map((f) => (
                  <li key={f} className="text-subtle">
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-5">{action(id)}</div>
            </Panel>
          );
        })}
      </div>

      {!signedOut && info && (
        <Panel className="mt-8 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">This month on {PLANS[current].name}</h2>
              <p className="mt-1 text-sm text-subtle">
                {status(sub ?? null, current)} Allowances reset on the 1st (UTC).
              </p>
            </div>
            {sub && (
              <Button disabled={busy !== null} onClick={() => void go('portal', api.billingPortal)}>
                {busy === 'portal' && <Spinner />} Manage subscription
              </Button>
            )}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {KINDS.map((k) => {
              const used = Math.min(info.used[k], info.limits[k]);
              const share = info.limits[k] ? used / info.limits[k] : 1;
              return (
                <div key={k}>
                  <div className="flex justify-between text-sm">
                    <span>{USAGE_LABEL[k].many.replace(/^./, (c) => c.toUpperCase())}</span>
                    <span className="text-subtle">
                      {used} of {info.limits[k]}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/8">
                    <div
                      className={cx('h-full rounded-full', share >= 1 ? 'bg-red-500' : share >= 0.8 ? 'bg-amber-500' : 'bg-foreground/60')}
                      style={{ width: `${Math.round(share * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <p className="mt-8 text-xs text-subtle">
        Payments are handled by Lemon Squeezy, our Merchant of Record. See the <Link href="/terms" className="underline">Terms</Link> and{' '}
        <Link href="/refunds" className="underline">Refund Policy</Link>. Questions about a payment? Use the contact on your receipt.
      </p>
    </div>
  );
}

function status(sub: BillingInfo['subscription'], current: PlanId) {
  if (!sub || current === 'free') {
    return sub?.status === 'expired' || sub?.status === 'cancelled' ? 'Your subscription has ended.' : '';
  }
  if (sub.status === 'cancelled' && sub.endsAt) {
    return (
      <>
        Cancelled: {PLANS[current].name} stays until <LocalDate iso={sub.endsAt} />, then Free.
      </>
    );
  }
  if (sub.status === 'past_due') return 'The last payment failed. Update your card in Manage subscription to keep your plan.';
  if (sub.renewsAt) {
    return (
      <>
        Renews on <LocalDate iso={sub.renewsAt} />.
      </>
    );
  }
  return '';
}
