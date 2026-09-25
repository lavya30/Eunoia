import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = {
  title: 'Create account | Eunoia',
  description:
    'Create an Eunoia account to open collaborative architecture whiteboard and D2 diagram rooms.',
};

export default async function SignupRoute({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next =
    typeof params.next === 'string' && params.next.trim()
      ? params.next.trim()
      : null;
  return <AuthForm mode="signup" next={next} />;
}
