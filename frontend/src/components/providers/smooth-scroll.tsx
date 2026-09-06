'use client';

import { useEffect } from 'react';
import Lenis, { type LenisOptions } from 'lenis';

let lenis: Lenis | null = null;

/** Access the active Lenis instance, if smooth scrolling is enabled. */
export function getLenis(): Lenis | null {
  return lenis;
}

/**
 * Smooth-scroll to a section. Uses Lenis when active so the glide stays
 * consistent, otherwise falls back to native smooth scrolling.
 */
export function scrollToSection(selector: string) {
  const el = document.querySelector(selector);
  if (!el) return;
  if (lenis) {
    lenis.scrollTo(el as HTMLElement, { offset: -90, duration: 1.4 });
  } else {
    el.scrollIntoView({ behavior: 'smooth' });
  }
}

const lenisOptions: LenisOptions = {
  lerp: 0.1,
  smoothWheel: true,
  autoRaf: true,
  // Animate in-page anchor jumps (e.g. href="#pricing") through Lenis,
  // offset so the sticky header doesn't cover section tops.
  anchors: { offset: -90, duration: 1.4 },
};

/**
 * Mount once in the root layout to enable Lenis smooth scrolling
 * site-wide. Skipped for users who prefer reduced motion.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    lenis = new Lenis(lenisOptions);
    return () => {
      lenis?.destroy();
      lenis = null;
    };
  }, []);

  return null;
}
