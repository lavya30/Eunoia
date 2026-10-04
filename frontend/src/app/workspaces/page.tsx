import { Suspense } from 'react';
import type { Metadata } from 'next';
import { WorkspacesPage } from '@/components/workspaces/WorkspacesPage';

export const metadata: Metadata = {
  title: 'Workspaces | Eunoia',
  description:
    'Manage Eunoia team workspaces, members, audit log, and usage — no board required.',
};

export default function WorkspacesRoute() {
  // useSearchParams() inside WorkspacesPage requires a Suspense boundary for
  // static prerendering.
  return (
    <Suspense>
      <WorkspacesPage />
    </Suspense>
  );
}
