import type { Metadata } from 'next';
import { Space_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import { ACTIVA_DEMO_LABEL } from '@/lib/constants';
import './globals.css';

const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display'
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono'
});

export const metadata: Metadata = {
  title: ACTIVA_DEMO_LABEL,
  description: 'A real Next.js demo app showcasing Activa presence, active user counts, heatmaps, and live streams.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
