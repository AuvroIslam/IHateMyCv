import type { Metadata } from 'next';
import Link from 'next/link';
import { Contact, Policy } from '@/components/Policy';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: `Terms of Service · ${SITE.name}` };

export default function TermsPage() {
  return (
    <Policy title="Terms of Service">
      <p>
        These terms cover your use of {SITE.name} (&ldquo;the service&rdquo;), run by {SITE.owner} (&ldquo;we&rdquo;). By
        creating an account or using the service you agree to them.
      </p>

      <h2>What the service does</h2>
      <p>
        You upload your CV. The service reproduces it, keeps your information in My Info, and uses AI models to tailor
        CVs to job descriptions, to edit them through chat, and to export them as PDFs.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You sign in with a Google account. Keep it secure. You are responsible for what happens under your account.</li>
        <li>You must be at least 16 years old to use the service.</li>
        <li>One person per account. Do not share accounts or make several accounts to get around limits.</li>
      </ul>

      <h2>Plans and payment</h2>
      <ul>
        <li>
          The Free plan costs nothing. Pro and Power are monthly subscriptions at the prices on the{' '}
          <Link href="/pricing">Pricing page</Link>. Each plan includes a set number of uploads, tailored CVs, chat
          messages and imports each calendar month (UTC). Unused allowance does not carry over.
        </li>
        <li>
          Our order process is conducted by our online reseller Lemon Squeezy (Lemon Squeezy, LLC), the Merchant of
          Record for all orders. Lemon Squeezy takes the payment, charges any sales tax or VAT, and issues your receipts.
          Their terms apply to the purchase as well.
        </li>
        <li>
          Subscriptions renew automatically each month until you cancel. Cancel at any time from Manage subscription on
          the Pricing page. You keep your plan until the end of the period you paid for, then move to Free.
        </li>
        <li>
          If we change a price, we will tell you before it applies. The new price starts at your next renewal after the
          notice.
        </li>
        <li>
          Refunds follow our <Link href="/refunds">Refund Policy</Link>.
        </li>
        <li>
          To keep the service fair and affordable, there are also daily limits on top of the monthly ones. We may
          suspend use that looks automated or abusive.
        </li>
      </ul>

      <h2>Your content</h2>
      <p>
        Your CVs, My Info and anything else you add stay yours. You give us permission to store and process them only
        as needed to run the service for you. That includes sending them to the AI providers listed in the{' '}
        <Link href="/privacy">Privacy Policy</Link>. Only upload material you have the right to use.
      </p>

      <h2>AI output</h2>
      <p>
        The AI can make mistakes. It may misread a CV, word something inaccurately or leave something out. Check every
        CV before you send it. You are responsible for what your CV says. The service is told not to invent experience,
        but it is your job to make sure each claim is true.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>No unlawful, misleading or fraudulent use, including CVs in someone else&rsquo;s name without their consent.</li>
        <li>No attempts to break, overload, scrape or reverse engineer the service, or to get around its limits.</li>
        <li>No reselling of the service.</li>
      </ul>

      <h2>Ending your use</h2>
      <p>
        You can stop using the service at any time. To have your account and data deleted, contact <Contact />. We may
        suspend or close accounts that break these terms. If we close a paid account without a breach on your part, we
        will refund the unused part of the current period.
      </p>

      <h2>Availability and liability</h2>
      <p>
        The service is provided &ldquo;as is&rdquo;. We work to keep it running and your data safe, but we cannot
        promise it will always be available or error free. As far as the law allows, we are not liable for indirect
        losses, such as a missed job opportunity. Our total liability is limited to the amount you paid us in the 3
        months before the claim. Nothing here limits rights you have under consumer law that cannot be waived.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. If a change matters, we will tell you in the app or by email before it takes effect.
        Continuing to use the service after that means you accept the new terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <Contact />.
      </p>
    </Policy>
  );
}
