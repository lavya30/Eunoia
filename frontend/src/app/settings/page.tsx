import type { Metadata } from 'next';
import { SettingsPage } from '@/components/settings/SettingsPage';

export const metadata: Metadata = {
  title: 'Settings | Eunoia',
  description: 'Account settings and local storage management.',
};

export default function SettingsRoute() {
  return <SettingsPage />;
}
