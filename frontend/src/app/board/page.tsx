import type { Metadata } from 'next';
import { WhiteboardPage } from '@/components/board/WhiteboardPage';

export const metadata: Metadata = {
  title: 'Board | Eunoia',
  description:
    'Collaborative architecture whiteboard with D2 code-to-diagram compilation.',
};

export default async function BoardRoute({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; ticket?: string }>;
}) {
  const params = await searchParams;
  const initialRoomId =
    typeof params.room === 'string' && params.room.trim()
      ? params.room.trim()
      : null;
  // The invite ticket travels via ?ticket= but is ingested by WhiteboardPage
  // itself (ingestTicketDeepLink into the ticket store); the route only
  // needs it for the remount key so rotation picks up fresh credentials.
  const ticket =
    typeof params.ticket === 'string' && params.ticket.trim()
      ? params.ticket.trim()
      : null;
  // Key by room AND ticket so invite-link rotation remounts with the fresh
  // credential instead of holding the old room's session.
  return (
    <WhiteboardPage
      key={initialRoomId ? `${initialRoomId}::${ticket ?? ''}` : 'new'}
      initialRoomId={initialRoomId}
    />
  );
}
