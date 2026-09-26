import type { Metadata } from 'next';
import { StatusPage } from '@/components/status/StatusPage';

export const metadata: Metadata = {
  title: 'Status | Eunoia',
  description: 'Live service status for the Eunoia sync server.',
};

export default function StatusRoute() {
  return <StatusPage />;
}
