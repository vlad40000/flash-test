import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FLASH-1 Theme Benchmark',
  description: 'Standalone single-image Gemini benchmark for FLASH-1 Theme Extraction.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
