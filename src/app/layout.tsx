import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { AppProvider } from '@/components/AppProvider';
import Nav from '@/components/Nav';
import { getAppState } from '@/lib/state';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'I Hate My CV',
  description:
    'Upload your CV once, keep everything about you in one place, and get a tailored CV for every job in your own design.',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const initial = await getAppState();

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AppProvider initial={initial}>
          <Nav />
          <main className="flex-1">{children}</main>
        </AppProvider>
      </body>
    </html>
  );
}
