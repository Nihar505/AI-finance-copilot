import type { Metadata } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'AI Finance & Compliance Copilot',
  description: 'AI handles repetitive financial operations; deterministic rules handle calculations; Chartered Accountants approve consequential ledger actions.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
