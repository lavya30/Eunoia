'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'eunoia:onboarded:v1';

const STEPS = [
  {
    title: 'Welcome to Eunoia',
    body: 'Pan with drag, zoom with the wheel. Everything saves to the server automatically.',
  },
  {
    title: 'Draw and connect',
    body: 'Use shapes, arrows, and freehand ink. Connectors snap magnetically to shapes.',
  },
  {
    title: 'Code diagrams with D2',
    body: 'Open the D2 panel to generate native canvas elements from text. Try a template first.',
  },
  {
    title: 'Share and collaborate',
    body: 'Share the room link, set a password for private boards, and follow peers from presence.',
  },
];

export function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect -- one-shot first-run gate reading localStorage, not a render loop. */
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!open) return null;
  const current = STEPS[step] ?? STEPS[0];

  const dismiss = (remember: boolean) => {
    if (remember) {
      try {
        window.localStorage.setItem(STORAGE_KEY, '1');
      } catch {
        // Best-effort.
      }
    }
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Getting started"
      style={styles.backdrop}
    >
      <div style={styles.card}>
        <p style={styles.kicker}>
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 style={styles.h2}>{current.title}</h2>
        <p style={styles.body}>{current.body}</p>
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.ghost}
            onClick={() => dismiss(true)}
          >
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 ? (
              <button
                type="button"
                style={styles.ghost}
                onClick={() => setStep((value) => Math.max(0, value - 1))}
              >
                Back
              </button>
            ) : null}
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                style={styles.primary}
                onClick={() => setStep((value) => value + 1)}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                style={styles.primary}
                onClick={() => dismiss(true)}
              >
                Start boarding
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(37,39,71,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 80,
    padding: 16,
  },
  card: {
    background: '#fff',
    borderRadius: 14,
    padding: 20,
    maxWidth: 420,
    width: '100%',
    boxShadow: '0 12px 48px rgba(37,39,71,0.25)',
  },
  kicker: {
    fontSize: 12,
    color: '#5b54c7',
    fontWeight: 700,
    margin: '0 0 4px',
  },
  h2: { fontSize: 20, margin: '0 0 8px' },
  body: { fontSize: 14, lineHeight: 1.5, margin: '0 0 16px' },
  actions: { display: 'flex', justifyContent: 'space-between', gap: 8 },
  ghost: {
    background: 'transparent',
    border: '1px solid #e3e2ea',
    borderRadius: 8,
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: 13,
  },
  primary: {
    background: '#5b54c7',
    color: '#fff',
    border: 0,
    borderRadius: 8,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
  },
};
