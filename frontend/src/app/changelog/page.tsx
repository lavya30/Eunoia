import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Changelog | Eunoia',
  description: 'What shipped recently in Eunoia boards, D2, and collaboration.',
};

const ENTRIES = [
  {
    date: '2026-10-04',
    title: 'Boards dashboard',
    body: 'Personal, team, recent, starred, archived, and trash views with search, templates, and JSON/D2 import.',
  },
  {
    date: '2026-10-04',
    title: 'Comments and follow mode',
    body: 'Thread-ready comment pins with @mentions and resolve, plus follow-a-peer viewport tracking.',
  },
  {
    date: '2026-10-04',
    title: 'Onboarding and offline groundwork',
    body: 'First-run tour, changelog, PWA manifest, and touch-friendly toolbar sizing.',
  },
];

export default function ChangelogRoute() {
  return (
    <main
      style={{
        padding: '32px 16px',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div style={{ maxWidth: 720, width: '100%' }}>
        <Link
          href="/"
          style={{ color: '#5b54c7', fontWeight: 600, fontSize: 14 }}
        >
          ← Eunoia
        </Link>
        <h1 style={{ fontSize: 28, margin: '8px 0' }}>Changelog</h1>
        <p style={{ color: '#6b6e86', fontSize: 14 }}>
          Short, human-readable release notes. The board keeps the full snapshot
          history per room.
        </p>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 16 }}>
          {ENTRIES.map((entry) => (
            <li
              key={`${entry.date}-${entry.title}`}
              style={{
                border: '1px solid #e3e2ea',
                borderRadius: 12,
                padding: 14,
                marginBottom: 12,
                background: '#fff',
              }}
            >
              <p style={{ fontSize: 12, color: '#6b6e86', margin: 0 }}>
                {entry.date}
              </p>
              <h2 style={{ fontSize: 17, margin: '4px 0' }}>{entry.title}</h2>
              <p style={{ fontSize: 14, margin: 0 }}>{entry.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
