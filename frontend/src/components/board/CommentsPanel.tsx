'use client';

import { useMemo, useState } from 'react';
import { type BoardComment } from '@/lib/whiteboard/comments';

type CommentPoint = { x: number; y: number };
type CommentPatch = { body?: string; resolved?: boolean };

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function CommentsPanel({
  comments,
  authorId,
  anchor,
  mentionCount,
  onAdd,
  onUpdate,
  onDelete,
  onFocus,
  onPlacePin,
  onCancelAnchor,
}: {
  comments: BoardComment[];
  authorId: string;
  anchor: CommentPoint | null;
  mentionCount: number;
  onAdd: (
    body: string,
    parentId: string | null,
    point: CommentPoint | null,
  ) => void;
  onUpdate: (commentId: string, patch: CommentPatch) => void;
  onDelete: (commentId: string) => void;
  onFocus: (comment: BoardComment) => void;
  onPlacePin: () => void;
  onCancelAnchor: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const roots = useMemo(
    () =>
      comments
        .filter((comment) => comment.parentId === null)
        .filter((comment) => showResolved || !comment.resolved)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [comments, showResolved],
  );

  const repliesFor = (parentId: string) =>
    comments
      .filter((comment) => comment.parentId === parentId)
      .sort((a, b) => a.createdAt - b.createdAt);

  const submit = () => {
    const body = draft.trim();
    if (!body || (replyTo === null && !anchor)) return;
    onAdd(body, replyTo, replyTo ? null : anchor);
    setDraft('');
    setReplyTo(null);
  };

  const startEdit = (comment: BoardComment) => {
    setEditingId(comment.id);
    setEditingDraft(comment.body);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const body = editingDraft.trim();
    if (!body) return;
    onUpdate(editingId, { body });
    setEditingId(null);
    setEditingDraft('');
  };

  const renderComment = (comment: BoardComment, isReply = false) => {
    const replies = !isReply ? repliesFor(comment.id) : [];
    const isDeleted = Boolean(comment.deletedAt);
    const isEditing = editingId === comment.id;
    return (
      <li key={comment.id} style={isReply ? styles.replyItem : styles.item}>
        <div style={styles.meta}>
          <strong>{comment.author}</strong>
          <span style={styles.time}>{formatTime(comment.updatedAt)}</span>
          {comment.resolved ? <span style={styles.badge}>Resolved</span> : null}
          {comment.mentions.length > 0 ? (
            <span style={styles.mentionBadge}>@</span>
          ) : null}
        </div>
        {isEditing ? (
          <div style={styles.editBox}>
            <textarea
              value={editingDraft}
              onChange={(event) => setEditingDraft(event.target.value)}
              rows={3}
              style={styles.textarea}
              aria-label="Edit comment"
              autoFocus
            />
            <div style={styles.actions}>
              <button type="button" style={styles.primary} onClick={saveEdit}>
                Save
              </button>
              <button
                type="button"
                style={styles.link}
                onClick={() => setEditingId(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p style={isDeleted ? styles.deletedBody : styles.body}>
            {isDeleted ? 'Comment deleted' : comment.body}
          </p>
        )}
        {!isDeleted && comment.mentions.length > 0 ? (
          <p style={styles.mentions}>
            Mentions: {comment.mentions.map((name) => `@${name}`).join(', ')}
          </p>
        ) : null}
        {!isDeleted && !isEditing ? (
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
              onClick={() => setReplyTo(comment.parentId ?? comment.id)}
            >
              Reply
            </button>
            <button
              type="button"
              style={styles.link}
              onClick={() =>
                onUpdate(comment.id, { resolved: !comment.resolved })
              }
            >
              {comment.resolved ? 'Reopen' : 'Resolve'}
            </button>
            {comment.authorId === authorId ? (
              <>
                <button
                  type="button"
                  style={styles.link}
                  onClick={() => startEdit(comment)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  style={styles.dangerLink}
                  onClick={() => onDelete(comment.id)}
                >
                  Delete
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {replies.length > 0 ? (
          <ul style={styles.replies}>
            {replies.map((reply) => renderComment(reply, true))}
          </ul>
        ) : null}
      </li>
    );
  };

  const replyingTo = replyTo
    ? comments.find((comment) => comment.id === replyTo)
    : null;

  return (
    <section aria-label="Board comments" style={styles.panel}>
      <header style={styles.header}>
        <div>
          <h2 style={styles.h2}>Comments ({roots.length})</h2>
          {mentionCount > 0 ? (
            <span style={styles.notification}>
              {mentionCount} mention{mentionCount === 1 ? '' : 's'} for you
            </span>
          ) : null}
        </div>
        <label style={styles.toggle}>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(event) => setShowResolved(event.target.checked)}
          />
          Resolved
        </label>
      </header>

      <div style={styles.composer}>
        {replyingTo ? (
          <div style={styles.replyingBar}>
            Replying to {replyingTo.author}
            <button
              type="button"
              style={styles.link}
              onClick={() => setReplyTo(null)}
            >
              Cancel
            </button>
          </div>
        ) : anchor ? (
          <div style={styles.anchorBar}>
            Pin at {Math.round(anchor.x)}, {Math.round(anchor.y)}
            <button type="button" style={styles.link} onClick={onCancelAnchor}>
              Change
            </button>
          </div>
        ) : (
          <div style={styles.anchorPrompt}>
            <span>Choose a point on the canvas for a new comment.</span>
            <button type="button" style={styles.primary} onClick={onPlacePin}>
              Place pin
            </button>
          </div>
        )}
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            replyTo
              ? 'Write a reply… use @name to mention'
              : 'Add a comment… use @name to mention'
          }
          rows={2}
          style={styles.textarea}
          aria-label={replyTo ? 'New reply' : 'New comment'}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || (replyTo === null && !anchor)}
          style={{
            ...styles.primary,
            opacity: draft.trim() && (replyTo !== null || anchor) ? 1 : 0.5,
          }}
        >
          {replyTo ? 'Reply' : 'Comment'}
        </button>
      </div>

      <ul style={styles.list}>
        {roots.map((comment) => renderComment(comment))}
        {roots.length === 0 ? (
          <li style={styles.empty}>
            No comments yet. Select Comment, then click anywhere on the canvas
            to pin a thread.
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
    boxShadow: '0 12px 30px rgba(37, 38, 58, 0.12)',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  h2: { fontSize: 14, fontWeight: 700, margin: 0 },
  notification: {
    display: 'block',
    marginTop: 3,
    color: '#6b5fd6',
    fontSize: 11,
    fontWeight: 700,
  },
  toggle: {
    fontSize: 12,
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    whiteSpace: 'nowrap',
  },
  composer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingBottom: 2,
  },
  anchorPrompt: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    color: '#6e7085',
    fontSize: 11,
    lineHeight: 1.35,
  },
  anchorBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: '#5b54c7',
    fontSize: 11,
    fontWeight: 700,
  },
  replyingBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: '#5b54c7',
    fontSize: 11,
    fontWeight: 700,
  },
  editBox: { display: 'flex', flexDirection: 'column', gap: 6 },
  textarea: {
    border: '1px solid #e3e2ea',
    borderRadius: 8,
    padding: 8,
    fontSize: 13,
    resize: 'vertical',
    fontFamily: 'inherit',
    color: '#25263a',
  },
  primary: {
    alignSelf: 'flex-start',
    border: 0,
    borderRadius: 7,
    padding: '7px 11px',
    background: '#5b54c7',
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  item: {
    border: '1px solid #eeedf2',
    borderRadius: 9,
    padding: 9,
    background: '#fcfcfe',
  },
  replyItem: {
    borderLeft: '2px solid #d9d6f5',
    padding: '7px 0 3px 9px',
    marginTop: 7,
  },
  replies: { listStyle: 'none', padding: 0, margin: 0 },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#35374a',
  },
  time: { color: '#9293a4', fontSize: 10 },
  badge: {
    background: '#e4f4e9',
    color: '#2e7d4f',
    borderRadius: 999,
    padding: '2px 6px',
    fontSize: 10,
    fontWeight: 700,
  },
  mentionBadge: { color: '#6b5fd6', fontWeight: 800 },
  body: {
    margin: '7px 0 4px',
    fontSize: 13,
    lineHeight: 1.45,
    color: '#35374a',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  deletedBody: {
    margin: '7px 0 4px',
    fontSize: 13,
    fontStyle: 'italic',
    color: '#9b9baa',
  },
  mentions: { margin: '4px 0', color: '#6b5fd6', fontSize: 11 },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  link: {
    border: 0,
    padding: 0,
    background: 'transparent',
    color: '#5b54c7',
    fontSize: 11,
    cursor: 'pointer',
  },
  dangerLink: {
    border: 0,
    padding: 0,
    background: 'transparent',
    color: '#b44b58',
    fontSize: 11,
    cursor: 'pointer',
  },
  empty: {
    color: '#7d7e91',
    fontSize: 12,
    lineHeight: 1.45,
    padding: '8px 2px',
  },
};
