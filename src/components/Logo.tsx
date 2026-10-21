/**
 * The logo: a CV page with an orange folded corner and a frown. The page
 * follows the text colour and the face is cut out in the background colour,
 * so it works in both themes; the corner is the accent.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path fill="currentColor" d="M20 6h19.5L52 18.5V52a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6z" />
      <path fill="var(--accent)" d="M39.5 6 52 18.5h-8.5a4 4 0 0 1-4-4z" />
      <circle cx="26.5" cy="33" r="3" fill="var(--background)" />
      <circle cx="39.5" cy="33" r="3" fill="var(--background)" />
      <path d="M26 47.5q7-5.5 14 0" fill="none" stroke="var(--background)" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}
