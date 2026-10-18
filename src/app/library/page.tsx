import { redirect } from 'next/navigation';

/** Every uploaded CV now lives in My CVs, each with its own design and content. */
export default function Page() {
  redirect('/cvs');
}
