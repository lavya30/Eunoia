'use client';

import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Sparkles,
  X,
} from 'lucide-react';
import type { BoardNode } from '@/lib/whiteboard/board-types';

interface PresenterHudProps {
  currentSlideIndex: number;
  totalSlides: number;
  frames: BoardNode[];
  laserActive: boolean;
  onToggleLaser: () => void;
  onPrevSlide: () => void;
  onNextSlide: () => void;
  onSelectSlide: (index: number) => void;
  onExit: () => void;
}

export function PresenterHud({
  currentSlideIndex,
  totalSlides,
  frames,
  laserActive,
  onToggleLaser,
  onPrevSlide,
  onNextSlide,
  onSelectSlide,
  onExit,
}: PresenterHudProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Browser permissions or security restriction
    }
  };

  return (
    <aside
      className="presenter-hud"
      role="region"
      aria-label="Presentation controls"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        background: 'rgba(26, 27, 38, 0.92)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
        color: '#f0f0f5',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Slide Navigation */}
      <button
        type="button"
        aria-label="Previous slide"
        title="Previous slide (Left Arrow)"
        disabled={currentSlideIndex <= 1}
        onClick={onPrevSlide}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: 8,
          border: 'none',
          background: currentSlideIndex <= 1 ? 'transparent' : 'rgba(255, 255, 255, 0.1)',
          color: currentSlideIndex <= 1 ? 'rgba(255, 255, 255, 0.3)' : '#ffffff',
          cursor: currentSlideIndex <= 1 ? 'default' : 'pointer',
        }}
      >
        <ChevronLeft size={18} />
      </button>

      {/* Slide Selector & Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select
          aria-label="Jump to slide"
          value={currentSlideIndex}
          onChange={(e) => onSelectSlide(Number(e.target.value))}
          style={{
            background: 'rgba(255, 255, 255, 0.12)',
            color: '#ffffff',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            borderRadius: 8,
            padding: '4px 8px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {frames.map((frame, idx) => (
            <option
              key={frame.id}
              value={idx + 1}
              style={{ background: '#1e1e2d', color: '#ffffff' }}
            >
              Slide {idx + 1}: {frame.label || 'Untitled'}
            </option>
          ))}
        </select>

        <span
          style={{
            fontSize: 13,
            opacity: 0.75,
            whiteSpace: 'nowrap',
          }}
        >
          {currentSlideIndex} / {Math.max(1, totalSlides)}
        </span>
      </div>

      <button
        type="button"
        aria-label="Next slide"
        title="Next slide (Right Arrow / Space)"
        disabled={currentSlideIndex >= totalSlides}
        onClick={onNextSlide}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: 8,
          border: 'none',
          background: currentSlideIndex >= totalSlides ? 'transparent' : 'rgba(255, 255, 255, 0.1)',
          color: currentSlideIndex >= totalSlides ? 'rgba(255, 255, 255, 0.3)' : '#ffffff',
          cursor: currentSlideIndex >= totalSlides ? 'default' : 'pointer',
        }}
      >
        <ChevronRight size={18} />
      </button>

      <span
        style={{
          width: 1,
          height: 20,
          background: 'rgba(255, 255, 255, 0.15)',
          margin: '0 4px',
        }}
      />

      {/* Laser pointer toggle */}
      <button
        type="button"
        aria-label="Toggle laser pointer"
        aria-pressed={laserActive}
        title="Laser pointer (P)"
        onClick={onToggleLaser}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderRadius: 8,
          border: 'none',
          background: laserActive ? '#ef4444' : 'rgba(255, 255, 255, 0.1)',
          color: '#ffffff',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: laserActive ? '0 0 12px rgba(239, 68, 68, 0.6)' : 'none',
        }}
      >
        <Sparkles size={15} />
        Laser
      </button>

      {/* Fullscreen toggle */}
      <button
        type="button"
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title="Toggle fullscreen (F11)"
        onClick={toggleFullscreen}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: 8,
          border: 'none',
          background: 'rgba(255, 255, 255, 0.1)',
          color: '#ffffff',
          cursor: 'pointer',
        }}
      >
        {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>

      {/* Exit presentation button */}
      <button
        type="button"
        aria-label="Exit presentation"
        title="Exit presentation (Esc)"
        onClick={onExit}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 8,
          border: 'none',
          background: 'rgba(239, 68, 68, 0.2)',
          color: '#fca5a5',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <X size={15} />
        Exit (Esc)
      </button>
    </aside>
  );
}
