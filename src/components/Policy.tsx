import type { ReactNode } from 'react';
import { SITE } from '@/lib/site';

/** The frame of a policy page: title, date, readable text. */
export function Policy({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-2xl px-5 py-10 text-sm leading-relaxed [&_a]:underline [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-subtle">Last updated {SITE.updated}</p>
      {children}
    </article>
  );
}

/** How to reach the owner: the support address when set, otherwise the contact details on the receipt. */
export function Contact() {
  return SITE.support ? (
    <a href={`mailto:${SITE.support}`}>{SITE.support}</a>
  ) : (
    <>the contact address on your receipt</>
  );
}
