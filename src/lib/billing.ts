import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PlanId } from './plans';

/**
 * Lemon Squeezy: the merchant of record. It sells the plans (and handles
 * tax, refunds and fraud), pays out to the owner's bank, and tells the app
 * about each subscription by webhook.
 *
 * Settings: LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID,
 * LEMONSQUEEZY_VARIANT_PRO, LEMONSQUEEZY_VARIANT_POWER (the monthly
 * variants' ids) and LEMONSQUEEZY_WEBHOOK_SECRET (the webhook's signing
 * secret).
 */

const API = 'https://api.lemonsqueezy.com/v1';
const env = (name: string) => process.env[name]?.trim() || undefined;

export const billingConfigured = () =>
  Boolean(env('LEMONSQUEEZY_API_KEY') && env('LEMONSQUEEZY_STORE_ID') && env('LEMONSQUEEZY_VARIANT_PRO') && env('LEMONSQUEEZY_VARIANT_POWER'));

export function variantOfPlan(plan: PlanId): string | undefined {
  if (plan === 'pro') return env('LEMONSQUEEZY_VARIANT_PRO');
  if (plan === 'power') return env('LEMONSQUEEZY_VARIANT_POWER');
  return undefined;
}

export function planOfVariant(variantId: string | number | undefined): PlanId | null {
  const id = String(variantId ?? '');
  if (id && id === env('LEMONSQUEEZY_VARIANT_PRO')) return 'pro';
  if (id && id === env('LEMONSQUEEZY_VARIANT_POWER')) return 'power';
  return null;
}

/** Whose subscription a webhook is about: the account id the checkout carried. Checked before it is used as a key. */
export const ACCOUNT_ID = /^[A-Za-z0-9_-]{6,128}$/;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const key = env('LEMONSQUEEZY_API_KEY');
  if (!key) throw new Error('Payments are not set up yet.');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`Lemon Squeezy ${path} failed: ${res.status} ${detail.slice(0, 300)}`);
    throw new Error('The payment service did not respond as expected. Try again in a minute.');
  }
  return (await res.json()) as T;
}

/** A hosted checkout for one plan, carrying the account id back to the webhook. */
export async function createCheckout(args: { plan: PlanId; accountId: string; email?: string; redirectUrl: string }): Promise<string> {
  const variant = variantOfPlan(args.plan);
  if (!variant) throw new Error('That plan cannot be bought.');
  const body = {
    data: {
      type: 'checkouts',
      attributes: {
        product_options: { redirect_url: args.redirectUrl },
        checkout_data: { ...(args.email ? { email: args.email } : {}), custom: { user_id: args.accountId } },
      },
      relationships: {
        store: { data: { type: 'stores', id: env('LEMONSQUEEZY_STORE_ID') } },
        variant: { data: { type: 'variants', id: variant } },
      },
    },
  };
  const res = await call<{ data: { attributes: { url: string } } }>('/checkouts', { method: 'POST', body: JSON.stringify(body) });
  return res.data.attributes.url;
}

/** A fresh link to the customer portal (cancel, change plan, update card, invoices). The links last 24 hours. */
export async function portalUrl(subscriptionId: string): Promise<string | null> {
  if (!/^\d+$/.test(subscriptionId)) return null;
  const res = await call<{ data: { attributes: { urls?: { customer_portal?: string } } } }>(`/subscriptions/${subscriptionId}`);
  return res.data.attributes.urls?.customer_portal ?? null;
}

/** The webhook's X-Signature: an HMAC-SHA256 hex digest of the raw body, with the signing secret. */
export function signatureValid(rawBody: string, signature: string | null): boolean {
  const secret = env('LEMONSQUEEZY_WEBHOOK_SECRET');
  if (!secret || !signature) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'utf8');
  const given = Buffer.from(signature.trim(), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
