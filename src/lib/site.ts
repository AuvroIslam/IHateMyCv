/**
 * Who runs the site and how to reach them, for the footer and the policy
 * pages. Set NEXT_PUBLIC_OWNER_NAME (the person or business that sells the
 * plans) and NEXT_PUBLIC_SUPPORT_EMAIL before taking payments.
 */
export const SITE = {
  name: 'I Hate My CV',
  owner: process.env.NEXT_PUBLIC_OWNER_NAME?.trim() || 'the operator of I Hate My CV',
  support: process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || '',
  /** When the policies last changed. */
  updated: '18 October 2026',
};
