import { Suspense } from 'react';
import type { Metadata } from 'next';
import { BillingPage } from '@/components/billing/BillingPage';

export const metadata: Metadata = {
  title: 'Billing & Subscription | Eunoia Architecture Whiteboard',
  description: 'Manage your Eunoia subscription, seats, and payment portal.',
};

export default function BillingRoute() {
  // useSearchParams() inside BillingPage requires a Suspense boundary for
  // static prerendering.
  return (
    <Suspense>
      <BillingPage />
    </Suspense>
  );
}
