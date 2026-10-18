import { handleRouteError, jsonError } from '@/lib/api';
import { portalUrl } from '@/lib/billing';
import { readStore } from '@/lib/store';
import { workspaceId } from '@/lib/workspace';

/** A fresh link to Lemon Squeezy's billing portal: cancel, change plan, update the card, invoices. */
export async function GET() {
  try {
    const store = await readStore(await workspaceId());
    const id = store.billing?.subscriptionId;
    if (!id) return jsonError('There is no subscription to manage.', 404);
    const url = await portalUrl(id);
    if (!url) return jsonError('The billing portal is not available right now.', 502);
    return Response.json({ url });
  } catch (err) {
    return handleRouteError(err);
  }
}
