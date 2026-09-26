import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: '#faf9f7',
        color: '#25263a',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>
          This page wandered off the canvas
        </h1>
        <p style={{ fontSize: 14, color: '#6b6d85', margin: '0 0 20px' }}>
          The link is broken or the page moved. Your boards are safe.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Link
            href="/board"
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              background: '#5b54c7',
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            Open a board
          </Link>
          <Link
            href="/"
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              border: '1px solid #e3e2ea',
              color: '#35374a',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
