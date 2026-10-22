import type { Metadata } from 'next';
import { Contact, Policy } from '@/components/Policy';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: `Privacy Policy · ${SITE.name}` };

export default function PrivacyPage() {
  return (
    <Policy title="Privacy Policy">
      <p>
        This policy covers what {SITE.name}, run by {SITE.owner}, collects, why, and who else handles it. A CV is
        personal, so we collect only what the service needs and never sell it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account:</strong> your name and email address from Google sign-in.
        </li>
        <li>
          <strong>Your content:</strong> the CVs you upload (the files, their text, fonts and page images), My Info,
          the CVs you make, job descriptions you paste, and your chat messages.
        </li>
        <li>
          <strong>Usage:</strong> how many uploads, tailored CVs, chat messages and imports you use each day and month,
          so plan limits work. To stop abuse, the daily counts are also kept per IP address.
        </li>
        <li>
          <strong>Subscription:</strong> your plan, its status and renewal date, and Lemon Squeezy&rsquo;s ids for your
          subscription. We never see or store your card details.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to run the service: to show and edit your CVs, tailor them, enforce plan limits, take payments, and answer
        you when you contact us. We do not use your content for advertising. We do not sell or rent it.
      </p>

      <h2>Who else processes it</h2>
      <ul>
        <li>
          <strong>Google Firebase</strong> (Google LLC): sign-in, the database and file storage.
        </li>
        <li>
          <strong>Render</strong> (Render Services, Inc.): hosts the app.
        </li>
        <li>
          <strong>Anthropic</strong> (Claude): reads your uploads and does the tailoring and chat. It receives your CV
          content, My Info and job descriptions. Under its commercial terms, Anthropic does not train its models on this
          data.
        </li>
        <li>
          <strong>OpenAI</strong>: reads the text of CVs you import into My Info. Our OpenAI account shares data with
          OpenAI, so OpenAI may use the text of those imports to improve its models. Nothing else you do goes to
          OpenAI.
        </li>
        <li>
          <strong>LaTeX-On-HTTP</strong> (YtoTech): if you upload a LaTeX CV (.tex or .zip), its files are sent there
          to be compiled into a PDF. Nothing else goes to it.
        </li>
        <li>
          <strong>Lemon Squeezy</strong> (Lemon Squeezy, LLC, a Stripe company): our Merchant of Record. Processes
          payments, taxes and receipts under its own privacy policy.
        </li>
      </ul>
      <p>
        These providers may process data outside your country, including in the United States and Singapore. They are
        bound by their own security and data protection terms.
      </p>

      <h2>Cookies</h2>
      <p>
        One cookie keeps you signed in. There are no advertising or tracking cookies and no analytics. Lemon
        Squeezy&rsquo;s checkout sets its own cookies.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Your content stays until you delete it or ask us to delete your account. Deleting a CV removes it right away.
        Usage counts are kept for the current period. Payment records are kept by Lemon Squeezy for as long as tax law
        requires.
      </p>

      <h2>Your rights</h2>
      <p>
        You can see and change your information in the app at any time. To get a copy of your data, have it deleted, or
        ask about it, contact <Contact />. We will answer within 30 days. Depending on where you live, you may also
        have the right to complain to a data protection authority.
      </p>

      <h2>Security</h2>
      <p>
        Data travels over HTTPS and is stored with Google Cloud, separately for each account. No system is perfectly
        secure. If a breach affects you, we will tell you.
      </p>

      <h2>Children</h2>
      <p>The service is not for anyone under 16.</p>

      <h2>Changes</h2>
      <p>If this policy changes in a way that matters, we will tell you in the app or by email first.</p>
    </Policy>
  );
}
