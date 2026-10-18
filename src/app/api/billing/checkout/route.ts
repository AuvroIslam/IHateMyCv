import { handleRouteError, jsonError } from '@/lib/api';
import { billingConfigured, createCheckout, portalUrl } from '@/lib/billing';
import { effectivePlan } from '@/lib/plans';
import { currentUser } from '@/lib/session';
import { readStore } from '@/lib/store';
import { workspaceId } from '@/lib/workspace';

/** Where the browser goes to pay: a new checkout, or - with a plan already running - the billing portal to change it. */
export async function POST(request: Request) {
  try {
    if (!billingConfigured()) return jsonError('Payments are not set up yet.', 503);
    const { plan } = (await request.json().catch(() => ({}))) as { plan?: string };
    if (plan !== 'pro' && plan !== 'power') return jsonError('Choose Pro or Power.');
    const ws = await workspaceId();
    const store = await readStore(ws);
    // One subscription per account: an existing one changes plan in the portal.
    if (store.billing?.subscriptionId && effectivePlan(store.billing) !== 'free') {
      const url = await portalUrl(store.billing.subscriptionId);
      if (url) return Response.json({ url, portal: true });
    }
    const user = await currentUser().catch(() => null);
    const origin = appOrigin(request);
    const url = await createCheckout({ plan, accountId: ws, email: user?.email, redirectUrl: `${origin}/pricing?paid=1` });
    return Response.json({ url });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** The site's public address: APP_URL when set, else what the proxy in front saw. */
function appOrigin(request: Request): string {
  const set = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (set) return set;
  const h = request.headers;
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? new URL(request.url).host;
  const proto = h.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  return `${proto}://${host}`;
}
