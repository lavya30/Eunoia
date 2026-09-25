import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = {
  title: 'Sign in | Eunoia',
  description:
    'Sign in to Eunoia to open your architecture whiteboard and D2 diagram rooms.',
};

export default async function LoginRoute({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next =
    typeof params.next === 'string' && params.next.trim()
      ? params.next.trim()
      : null;
  return <AuthForm mode="login" next={next} />;
}
