import type { Metadata } from 'next';
import { PricingPage } from '@/components/billing/PricingPage';

export const metadata: Metadata = {
  title: 'Pricing | Eunoia Architecture Whiteboard',
  description:
    'Choose your plan for Eunoia whiteboard and system architecture compilation.',
};

export default function PricingRoute() {
  return <PricingPage />;
}
