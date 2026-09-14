import type { Metadata } from 'next';
import '@/styles/globals.css';
import '@/styles/marketing.css';

export const metadata: Metadata = {
  title: 'FinCopilot | Controlled financial close for CA firms',
  description: 'An evidence-backed monthly-close workspace for Indian Chartered Accountants and finance teams.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
