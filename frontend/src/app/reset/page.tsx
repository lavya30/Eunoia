import type { Metadata } from 'next';
import { ResetPage } from '@/components/auth/ResetPage';

export const metadata: Metadata = {
  title: 'Reset password | Eunoia',
  description: 'Choose a new password for your Eunoia account.',
};

export default function ResetRoute() {
  return <ResetPage />;
}
