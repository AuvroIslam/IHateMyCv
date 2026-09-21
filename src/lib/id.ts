import { customAlphabet } from 'nanoid';

const alphabet = '23456789abcdefghijkmnpqrstuvwxyz';

/** Short, unambiguous, URL-safe ids. */
export const newId = customAlphabet(alphabet, 10);

export function slugify(input: string, fallback = 'section'): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}
