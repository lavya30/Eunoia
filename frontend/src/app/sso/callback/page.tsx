import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SsoCallback } from '@/components/auth/SsoCallback';

export const metadata: Metadata = {
  title: 'Completing sign-in | Eunoia',
  description: 'Completing single sign-on.',
};

export default function SsoCallbackRoute() {
  // useSearchParams is not used here, but Suspense keeps the route
  // statically prerenderable regardless of client-only APIs.
  return (
    <Suspense>
      <SsoCallback />
    </Suspense>
  );
}
