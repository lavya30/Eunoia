import { WhiteboardPage } from '@/components/board/WhiteboardPage';

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
  // Key by room so switching rooms fully remounts with fresh state.
  return (
    <WhiteboardPage
      key={initialRoomId ?? 'new'}
      initialRoomId={initialRoomId}
    />
  );
}
