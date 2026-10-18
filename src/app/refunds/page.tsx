import type { Metadata } from 'next';
import Link from 'next/link';
import { Contact, Policy } from '@/components/Policy';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: `Refund Policy · ${SITE.name}` };

export default function RefundsPage() {
  return (
    <Policy title="Refund Policy">
      <p>
        You can try {SITE.name} on the Free plan before you pay. If a paid plan does not work out, here is how refunds
        work.
      </p>

      <h2>14-day refund</h2>
      <p>
        If you are not happy, ask within 14 days of any charge and we will refund that charge in full. You do not need
        to give a reason. This applies to your first payment and to each renewal.
      </p>

      <h2>How to ask</h2>
      <p>
        Contact <Contact /> from the email address you paid with, and include your order number from the receipt.
        Lemon Squeezy, our Merchant of Record, processes the refund to your original payment method. It usually arrives
        within 5 to 10 business days, depending on your bank.
      </p>

      <h2>Cancelling</h2>
      <p>
        Cancel at any time from Manage subscription on the <Link href="/pricing">Pricing page</Link>. You will not be
        charged again. You keep your plan until the end of the period you paid for, then move to Free. Cancelling on its
        own does not refund the current period. To get money back, ask for a refund as described above.
      </p>

      <h2>Changing plans</h2>
      <p>
        When you move between Pro and Power, Lemon Squeezy adjusts the charge for the rest of the month. Upgrading
        charges the difference, and downgrading leaves a credit for your next renewal.
      </p>

      <h2>After 14 days</h2>
      <p>
        Charges older than 14 days are not normally refunded. If the service was down or broken for you, contact us
        anyway and we will put it right.
      </p>
    </Policy>
  );
}
