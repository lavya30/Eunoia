import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { SmoothScroll } from '@/components/providers/smooth-scroll';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Eunoia | Architecture Whiteboard & D2 Diagram Canvas',
  description:
    'Sketch, diagram, and collaborate seamlessly with Eunoia — the modern architecture whiteboard with native D2 support.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#5b54c7',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
