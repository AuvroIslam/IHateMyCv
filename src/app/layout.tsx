import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { AppProvider } from '@/components/AppProvider';
import Footer from '@/components/Footer';
import Nav from '@/components/Nav';
import { getAppState } from '@/lib/state';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

const description =
  'Upload your CV once, keep everything about you in one place, and get a tailored CV for every job in your own design.';

export const metadata: Metadata = {
  // Absolute links for the share image; APP_URL is the public address.
  metadataBase: new URL(process.env.APP_URL?.trim() || 'https://ihatemycv.com'),
  title: 'I Hate My CV',
  description,
  applicationName: 'I Hate My CV',
  openGraph: { type: 'website', siteName: 'I Hate My CV', title: 'I Hate My CV', description },
  twitter: { card: 'summary_large_image', title: 'I Hate My CV', description },
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const initial = await getAppState();

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AppProvider initial={initial}>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
        </AppProvider>
      </body>
    </html>
  );
}
