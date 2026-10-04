import type { Metadata } from 'next';
import { ForgotPage } from '@/components/auth/ForgotPage';

export const metadata: Metadata = {
  title: 'Forgot password | Eunoia',
  description: 'Request a password reset for your Eunoia account.',
};

export default function ForgotRoute() {
  return <ForgotPage />;
}
