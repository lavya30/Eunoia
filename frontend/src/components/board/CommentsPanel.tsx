'use client';

import { useMemo, useState } from 'react';
import {
  extractMentions,
  getComments,
  saveComments,
  type BoardComment,
} from '@/lib/whiteboard/comments';

function newId(): string {
  return `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CommentsPanel({
  roomId,
  author,
  onFocus,
}: {
  roomId: string;
  author: string;
  onFocus: (comment: BoardComment) => void;
}) {
  const [comments, setComments] = useState<BoardComment[]>(() =>
    getComments(roomId),
  );
  const [draft, setDraft] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const visible = useMemo(
    () =>
      comments
        .filter((comment) => showResolved || !comment.resolved)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [comments, showResolved],
  );

  const persist = (next: BoardComment[]) => {
    setComments(next);
    saveComments(roomId, next);
  };

  const addComment = () => {
    const body = draft.trim();
    if (!body) return;
    const next: BoardComment[] = [
      ...comments,
      {
        id: newId(),
        x: 0,
        y: 0,
        body,
        author: author.trim() || 'Anonymous',
        mentions: extractMentions(body),
        resolved: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    persist(next);
    setDraft('');
  };

  return (
    <section aria-label="Board comments" style={styles.panel}>
      <header style={styles.header}>
        <h2 style={styles.h2}>Comments ({visible.length})</h2>
        <label style={styles.toggle}>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(event) => setShowResolved(event.target.checked)}
          />
          Show resolved
        </label>
      </header>
      <div style={styles.composer}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a comment… use @name to mention"
          rows={2}
          style={styles.textarea}
          aria-label="New comment"
        />
        <button
          type="button"
          onClick={addComment}
          disabled={!draft.trim()}
          style={{
            ...styles.primary,
            opacity: draft.trim() ? 1 : 0.5,
          }}
        >
          Comment
        </button>
      </div>
      <ul style={styles.list}>
        {visible.map((comment) => (
          <li key={comment.id} style={styles.item}>
            <div style={styles.meta}>
              <strong>{comment.author}</strong>
              <span style={styles.time}>
                {new Date(comment.updatedAt).toLocaleString()}
              </span>
              {comment.resolved ? (
                <span style={styles.badge}>Resolved</span>
              ) : null}
            </div>
            <p style={styles.body}>{comment.body}</p>
            {comment.mentions.length > 0 ? (
              <p style={styles.mentions}>
                Mentions:{' '}
                {comment.mentions.map((name) => `@${name}`).join(', ')}
              </p>
            ) : null}
            <div style={styles.actions}>
              <button
                type="button"
                style={styles.link}
                onClick={() => onFocus(comment)}
              >
                Focus
              </button>
              <button
                type="button"
                style={styles.link}
                onClick={() =>
                  persist(
                    comments.map((entry) =>
                      entry.id === comment.id
                        ? {
                            ...entry,
                            resolved: !entry.resolved,
                            updatedAt: Date.now(),
                          }
                        : entry,
                    ),
                  )
                }
              >
                {comment.resolved ? 'Reopen' : 'Resolve'}
              </button>
            </div>
          </li>
        ))}
        {visible.length === 0 ? (
          <li style={styles.empty}>
            No comments yet. Notes here are thread-ready pins.
          </li>
        ) : null}
      </ul>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    border: '1px solid #e3e2ea',
    borderRadius: 12,
    padding: 12,
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  h2: { fontSize: 14, fontWeight: 700, margin: 0 },
  toggle: { fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' },
  composer: { display: 'flex', flexDirection: 'column', gap: 8 },
  textarea: {
    border: '1px solid #e3e2ea',
    borderRadius: 8,
    padding: 8,
    fontSize: 13,
    resize: 'vertical',
  },
  primary: {
    alignSelf: 'flex-end',
    background: '#5b54c7',
    color: '#fff',
    border: 0,
    borderRadius: 8,
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  item: { border: '1px solid #f0eff6', borderRadius: 8, padding: 8 },
  meta: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 },
  time: { opacity: 0.6 },
  badge: {
    fontSize: 11,
    background: '#e9f5ee',
    color: '#2f9e6e',
    borderRadius: 6,
    padding: '1px 6px',
    fontWeight: 700,
  },
  body: { fontSize: 13, margin: '6px 0' },
  mentions: { fontSize: 12, color: '#5b54c7', margin: '0 0 4px' },
  actions: { display: 'flex', gap: 12 },
  link: {
    background: 'transparent',
    border: 0,
    color: '#5b54c7',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    padding: 0,
  },
  empty: { fontSize: 13, opacity: 0.65 },
};
