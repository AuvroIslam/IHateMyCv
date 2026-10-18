import { handleRouteError } from '@/lib/api';
import { billingConfigured } from '@/lib/billing';
import { usageThisMonth } from '@/lib/limits';
import { PLANS, effectivePlan } from '@/lib/plans';
import { readStore } from '@/lib/store';
import { workspaceId } from '@/lib/workspace';

/** The account's plan, what it allows and what has been used this month. */
export async function GET() {
  try {
    const ws = await workspaceId();
    const store = await readStore(ws);
    const plan = effectivePlan(store.billing);
    return Response.json({
      plan,
      limits: PLANS[plan].monthly,
      used: await usageThisMonth(ws),
      subscription: store.billing
        ? { status: store.billing.status, plan: store.billing.plan, renewsAt: store.billing.renewsAt, endsAt: store.billing.endsAt }
        : null,
      payments: billingConfigured(),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
