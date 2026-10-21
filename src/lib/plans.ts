import type { Billing } from '@/types/cv';

/**
 * The plans and what each allows a month. Limits are set so that even a
 * user who uses every last one costs less in AI than the plan brings in
 * (measured: an upload ~$0.18, a tailored CV ~$0.05, a chat message
 * ~$0.012, an import ~$0.003). Change them here; everything reads from this.
 */

export type PlanId = 'free' | 'pro' | 'power';
export type UsageKind = 'upload' | 'tailor' | 'chat' | 'import';

export interface Plan {
  id: PlanId;
  name: string;
  /** USD a month. */
  price: number;
  blurb: string;
  monthly: Record<UsageKind, number>;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    blurb: 'Try it on your own CV.',
    monthly: { upload: 8, tailor: 40, chat: 300, import: 30 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 10,
    blurb: 'For an active job search.',
    monthly: { upload: 8, tailor: 40, chat: 300, import: 30 },
  },
  power: {
    id: 'power',
    name: 'Power',
    price: 25,
    blurb: 'Applying everywhere, every week.',
    monthly: { upload: 20, tailor: 120, chat: 800, import: 100 },
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'pro', 'power'];

/**
 * Launch offer: until paid plans open, the Free plan gets Pro's monthly
 * allowances. On unless NEXT_PUBLIC_LAUNCH_PROMO=off (set it on Render and
 * redeploy to end the offer; Free then goes back to its own allowances).
 */
export const LAUNCH_PROMO = process.env.NEXT_PUBLIC_LAUNCH_PROMO !== 'off';

/** What a plan allows a month, launch offer included. */
export function monthlyLimits(plan: PlanId): Record<UsageKind, number> {
  return plan === 'free' && LAUNCH_PROMO ? PLANS.pro.monthly : PLANS[plan].monthly;
}

export const USAGE_LABEL: Record<UsageKind, { one: string; many: string }> = {
  upload: { one: 'CV upload', many: 'CV uploads' },
  tailor: { one: 'tailored CV', many: 'tailored CVs' },
  chat: { one: 'chat message', many: 'chat messages' },
  import: { one: 'import into My Info', many: 'imports into My Info' },
};

/**
 * The plan a subscription gives right now. Paid access lasts while it is
 * active, on trial, or retrying a failed payment, and after cancelling until
 * the paid period ends.
 */
export function effectivePlan(billing: Billing | null | undefined, now = Date.now()): PlanId {
  if (!billing || billing.plan === 'free') return 'free';
  if (billing.status === 'active' || billing.status === 'on_trial' || billing.status === 'past_due') return billing.plan;
  if (billing.status === 'cancelled' && billing.endsAt && Date.parse(billing.endsAt) > now) return billing.plan;
  return 'free';
}
