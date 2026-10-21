import type { MetadataRoute } from 'next';

/** Lets phones add the site to the home screen with its own name and icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'I Hate My CV',
    short_name: 'I Hate My CV',
    description: 'Upload your CV once and get a version tailored to every job, in your own design.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f6f4',
    theme_color: '#f6f6f4',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
