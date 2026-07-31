import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nurturing | Photo System',
  description: 'Facial recognition photo delivery for childcare centers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
