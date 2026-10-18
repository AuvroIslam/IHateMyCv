import { ACCOUNT_ID, planOfVariant, signatureValid } from '@/lib/billing';
import { mutateStore } from '@/lib/store';
import type { Billing } from '@/types/cv';

/**
 * Lemon Squeezy's webhook: every change to a subscription (created,
 * renewed, plan changed, cancelled, expired...). Signed with the webhook's
 * secret; the account it belongs to is the id the checkout carried.
 * Subscribe it to the subscription_* events.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!signatureValid(raw, request.headers.get('x-signature'))) {
    return Response.json({ error: 'Invalid signature.' }, { status: 401 });
  }
  let event: {
    meta?: { event_name?: string; custom_data?: { user_id?: string }; test_mode?: boolean };
    data?: { type?: string; id?: string; attributes?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Not JSON.' }, { status: 400 });
  }

  // Payment events carry invoices; the subscription_updated that follows them carries the state.
  if (event.data?.type !== 'subscriptions' || !event.data.id) return Response.json({ ok: true, ignored: true });
  const account = event.meta?.custom_data?.user_id;
  if (!account || !ACCOUNT_ID.test(account)) {
    console.error(`Webhook ${event.meta?.event_name}: subscription ${event.data.id} has no account id.`);
    return Response.json({ ok: true, ignored: true });
  }

  const a = event.data.attributes ?? {};
  const plan = planOfVariant(a.variant_id as number | undefined);
  const billing: Billing = {
    plan: plan ?? 'free',
    status: String(a.status ?? 'expired'),
    subscriptionId: String(event.data.id),
    customerId: a.customer_id != null ? String(a.customer_id) : undefined,
    variantId: a.variant_id != null ? String(a.variant_id) : undefined,
    renewsAt: (a.renews_at as string | null) ?? null,
    endsAt: (a.ends_at as string | null) ?? null,
    testMode: Boolean(event.meta?.test_mode ?? a.test_mode),
    updatedAt: new Date().toISOString(),
  };
  if (!plan) console.error(`Webhook: variant ${String(a.variant_id)} matches no plan; treated as free.`);

  await mutateStore((store) => {
    // A late webhook about an older subscription must not undo the current one.
    if (store.billing && store.billing.subscriptionId !== billing.subscriptionId && billing.status === 'expired') return;
    store.billing = billing;
  }, account);
  return Response.json({ ok: true });
}
