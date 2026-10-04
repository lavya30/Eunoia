import { Suspense } from 'react';
import type { Metadata } from 'next';
import { DashboardPage } from '@/components/dashboard/DashboardPage';

export const metadata: Metadata = {
  title: 'Boards | Eunoia',
  description:
    'Browse personal, team, recent, starred, and trashed boards — plus templates and imports.',
};

export default function DashboardRoute() {
  return (
    <Suspense>
      <DashboardPage />
    </Suspense>
  );
}
