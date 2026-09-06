'use client';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { BlurFade } from '@/components/ui/blur-fade';
import { TextAnimate } from '@/components/ui/text-animate';
import { AnimatedShinyText } from '@/components/ui/animated-shiny-text';
import {
  Terminal,
  AnimatedSpan,
  TypingAnimation,
} from '@/components/ui/terminal';
import { MagicCard } from '@/components/ui/magic-card';
import { NumberTicker } from '@/components/ui/number-ticker';
import { AvatarCircles } from '@/components/ui/avatar-circles';
import { AnimatedList } from '@/components/ui/animated-list';
import { Safari } from '@/components/ui/safari';
import { AnimatedBeam } from '@/components/ui/animated-beam';
import { BorderBeam } from '@/components/ui/border-beam';
import { Highlighter } from '@/components/ui/highlighter';
import { OrbitingCircles } from '@/components/ui/orbiting-circles';
import { Tree, Folder, File } from '@/components/ui/file-tree';
import { WordRotate } from '@/components/ui/word-rotate';
import { ScrollProgress } from '@/components/ui/scroll-progress';
import { CoolMode } from '@/components/ui/cool-mode';
import { SpinningText } from '@/components/ui/spinning-text';
import {
  ScrollVelocityContainer,
  ScrollVelocityRow,
} from '@/components/ui/scroll-based-velocity';
import React, { useRef, useState, type ReactNode } from 'react';
import { DiaTextReveal } from '@/components/ui/dia-text-reveal';
import { scrollToSection } from '@/components/providers/smooth-scroll';
import './landing.css';

/* ─── SVG Icons (Self-Contained & Optimized) ─── */
const ArrowRight = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

const ChevronDown = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const Github = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

const Globe2 = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </svg>
);

const Menu = ({ size = 24 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="4" x2="20" y1="12" y2="12" />
    <line x1="4" x2="20" y1="6" y2="6" />
    <line x1="4" x2="20" y1="18" y2="18" />
  </svg>
);

const MessageCircle = ({ size = 17 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
  </svg>
);

const X = ({ size = 24 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const Zap = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);

const Check = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/* ─── Assets (Local Static Files) ─── */
const assets = {
  doodles: '/images/home-hero.svg',
  pen: '/images/pen-tip.svg',
  bulb: '/images/bulb_icon.svg',
  collab: '/images/collaborate_arrows_icon.svg',
  target: '/images/target_arrow_icon.svg',
  stars: '/images/stars_icon.svg',
  hand: '/images/hand_easy_icon.svg',
  logoIcon: '/images/logo_icon.svg',
  playground: '/images/editor_playground.png',
};

const avatars = [
  {
    imageUrl: 'https://avatars.githubusercontent.com/u/16860528?v=4',
    profileUrl: 'https://github.com',
  },
  {
    imageUrl: 'https://avatars.githubusercontent.com/u/20110627?v=4',
    profileUrl: 'https://github.com',
  },
  {
    imageUrl: 'https://avatars.githubusercontent.com/u/106103625?v=4',
    profileUrl: 'https://github.com',
  },
  {
    imageUrl: 'https://avatars.githubusercontent.com/u/59228569?v=4',
    profileUrl: 'https://github.com',
  },
  {
    imageUrl: 'https://avatars.githubusercontent.com/u/59442788?v=4',
    profileUrl: 'https://github.com',
  },
];

const companies = [
  'NETFLIX',
  'Meta',
  'Intel',
  'CAPCO',
  'Wix',
  'Swappie',
  'reddit',
  'Vercel',
  'Linear',
  'Memfault',
  'BLUEBEAM',
  'ROKT',
];

/* Stable CoolMode options (module-level so the effect doesn't re-bind). */
const pencilBurst = { particle: '✏️' };

function Button({
  children,
  kind = 'primary',
  href = '#',
}: {
  children: ReactNode;
  kind?: 'primary' | 'secondary';
  href?: string;
}) {
  return (
    <a
      href={href}
      className={`eunoia-button ${
        kind === 'secondary' ? 'eunoia-button--secondary' : ''
      }`}
    >
      {children}
    </a>
  );
}

/* ─── Magic UI: live collaboration beam demo ─── */
function CollabBeamDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const userARef = useRef<HTMLDivElement>(null);
  const userBRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className="relative mx-auto flex w-full max-w-3xl items-center justify-between gap-4 rounded-2xl border border-[#e7e6ef] bg-white/80 px-6 py-10 shadow-[0_18px_36px_rgba(74,71,106,0.10)] backdrop-blur sm:px-10"
    >
      <div
        ref={userARef}
        className="relative z-10 flex flex-col items-center gap-2"
      >
        <div className="grid size-14 place-items-center rounded-full border-2 border-[#6965DB] bg-[#e9e8ff] text-lg font-extrabold text-[#17174a]">
          AK
        </div>
        <span className="text-xs font-bold text-[#29275d]">Anya · editing</span>
        <span className="flex items-center gap-1 rounded-full bg-[#d8ffdf] px-2 py-0.5 text-[11px] font-bold text-[#17174a]">
          <span className="size-1.5 rounded-full bg-green-500" /> live
        </span>
      </div>

      <div
        ref={roomRef}
        className="relative z-10 flex flex-col items-center gap-2"
      >
        <div className="grid size-20 place-items-center rounded-2xl bg-[#6965DB] text-white shadow-[0_8px_24px_rgba(105,101,219,0.45)]">
          <svg width="34" height="34" viewBox="0 0 32 32" fill="none">
            <path
              d="M9 16H23M16 9V23M11 11L21 21M21 11L11 21"
              stroke="#FFFFFF"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <span className="text-xs font-bold text-[#29275d]">incident-room</span>
        <span className="font-mono text-[11px] text-[#8c8b9f]">
          &lt;50ms sync · Yjs
        </span>
      </div>

      <div
        ref={userBRef}
        className="relative z-10 flex flex-col items-center gap-2"
      >
        <div className="grid size-14 place-items-center rounded-full border-2 border-[#ffb005] bg-[#fff4c9] text-lg font-extrabold text-[#17174a]">
          JO
        </div>
        <span className="text-xs font-bold text-[#29275d]">
          Jonas · reviewing
        </span>
        <span className="flex items-center gap-1 rounded-full bg-[#fff4c9] px-2 py-0.5 text-[11px] font-bold text-[#17174a]">
          <span className="size-1.5 rounded-full bg-amber-500" /> cursor
        </span>
      </div>

      <AnimatedBeam
        containerRef={containerRef}
        fromRef={userARef}
        toRef={roomRef}
        curvature={-60}
        
        gradientStartColor="#6965DB"
        gradientStopColor="#22c55e"
        pathColor="#e2e1ea"
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={roomRef}
        toRef={userBRef}
        
        curvature={-60}
        gradientStartColor="#22c55e"
        gradientStopColor="#ffb005"
        pathColor="#e2e1ea"
        reverse
      />
    </div>
  );
}

/* ─── Magic UI: live room activity feed ─── */
function ActivityFeed() {
  const items = [
    { name: 'Anya moved api-gateway → edge', time: '2s', color: '#6965DB' },
    { name: 'Jonas compiled D2 · 42 nodes', time: '18s', color: '#22c55e' },
    { name: 'Priya added incident note', time: '41s', color: '#ffb005' },
    { name: 'Snapshot saved · 12.4 KB', time: '1m', color: '#0ea5e9' },
  ];
  return (
    <AnimatedList delay={1400} className="w-full max-w-md gap-3">
      {items.map((n) => (
        <div
          key={n.name}
          className="flex w-full items-center gap-3 rounded-xl border border-[#e7e6ef] bg-white px-4 py-3 shadow-sm"
        >
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full text-white"
            style={{ background: n.color }}
          >
            <Zap size={14} />
          </span>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-bold text-[#242257]">
              {n.name}
            </p>
            <p className="font-mono text-[11px] text-[#8c8b9f]">
              {n.time} ago · synced
            </p>
          </div>
          <Check size={14} />
        </div>
      ))}
    </AnimatedList>
  );
}

/* ─── Magic UI: D2 terminal demo ─── */
function D2TerminalDemo() {
  return (
    <Terminal className="max-w-xl border-[#e7e6ef] bg-[#0d0d1a] text-left shadow-[0_18px_36px_rgba(74,71,106,0.25)]">
      <TypingAnimation duration={28} className="text-[#9df0c0]">
        $ eunoia compile infra.d2 --target canvas
      </TypingAnimation>
      <AnimatedSpan className="text-neutral-400">
        <span>▸ parsing D2 source … 42 nodes, 68 edges</span>
      </AnimatedSpan>
      <AnimatedSpan className="text-neutral-300">
        <span>
          ▸ reconciling AST →{' '}
          <span className="text-[#9df0c0]">native vector objects</span> (diff:
          +6 −2)
        </span>
      </AnimatedSpan>
      <AnimatedSpan className="text-neutral-300">
        <span>
          ▸ render <span className="font-bold text-white">312ms</span> ·
          snapshot compressed <span className="text-[#ffb005]">12.4 KB</span>
        </span>
      </AnimatedSpan>
      <AnimatedSpan className="text-[#9df0c0]">
        <span>✓ canvas updated — last valid view kept on error</span>
      </AnimatedSpan>
    </Terminal>
  );
}

/* ─── Magic UI: room file tree (engineering vernacular for the D2 section) ─── */
function RoomFileTree() {
  const [selected, setSelected] = useState('infra.d2');
  const files = [
    { name: 'infra.d2', meta: '4.1 KB' },
    { name: 'board.snapshot', meta: '12.4 KB' },
    { name: 'presence.json', meta: 'live' },
  ];
  return (
    <Tree label="Room files" className="w-full max-w-xs">
      <Folder name="incident-room" defaultOpen badge="synced">
        <Folder name="diagrams" defaultOpen>
          {files.map((f) => (
            <File
              key={f.name}
              name={f.name}
              meta={f.meta}
              selected={selected === f.name}
              onSelect={() => setSelected(f.name)}
            />
          ))}
        </Folder>
        <Folder name="exports">
          <File
            name="service-map.svg"
            meta="SVG"
            selected={selected === 'service-map.svg'}
            onSelect={() => setSelected('service-map.svg')}
          />
          <File
            name="notes.md"
            meta="2 KB"
            selected={selected === 'notes.md'}
            onSelect={() => setSelected('notes.md')}
          />
        </Folder>
      </Folder>
    </Tree>
  );
}

/* ─── Magic UI: open-plumbing orbit (the stack, orbiting the product) ─── */
function TechOrbit() {
  const chip =
    'border border-[#e2e1ea] bg-white px-3 py-1.5 text-[12px] font-extrabold whitespace-nowrap text-[#242257] shadow-sm';
  return (
    <div
      className="relative mx-auto flex h-[420px] w-full max-w-2xl items-center justify-center sm:h-[480px]"
      role="img"
      aria-label="Eunoia at the center, orbited by D2, Yjs, Monaco, PostgreSQL, Redis, and Next.js"
    >
      {/* center: the product */}
      <div className="absolute top-1/2 left-1/2 z-10 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl bg-[#6965DB] shadow-[0_8px_24px_rgba(105,101,219,0.45)]">
        <svg
          width="34"
          height="34"
          viewBox="0 0 32 32"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M9 16H23M16 9V23M11 11L21 21M21 11L11 21"
            stroke="#FFFFFF"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      {/* inner ring: authoring */}
      <OrbitingCircles
        radius={110}
        duration={24}
        iconSize={40}
        className={chip}
      >
        <span>D2</span>
        <span>Yjs</span>
        <span>Monaco</span>
      </OrbitingCircles>
      {/* outer ring: platform */}
      <OrbitingCircles
        radius={175}
        duration={36}
        reverse
        iconSize={40}
        className={chip}
      >
        <span>PostgreSQL</span>
        <span>Redis</span>
        <span>Next.js</span>
        <span>Bun</span>
      </OrbitingCircles>
    </div>
  );
}

function FeatureStep({
  icon,
  tag,
  title,
  intro,
  children,
  last = false,
  delay = 0,
}: {
  icon: string;
  tag: string;
  title: string;
  intro: string;
  children: ReactNode;
  last?: boolean;
  delay?: number;
}) {
  return (
    <BlurFade delay={delay} inView>
      <article
        className={`eunoia-feature-step ${
          last ? 'eunoia-feature-step--last' : ''
        }`}
      >
        <div className="eunoia-feature-rail" aria-hidden="true">
          <img src={icon} alt="" />
        </div>
        <span className="eunoia-drawn-label">{tag}</span>
        <TextAnimate as="h2" by="word" animation="blurInUp" startOnView once>
          {title}
        </TextAnimate>
        <h4>{intro}</h4>
        {children}
      </article>
    </BlurFade>
  );
}

function DoodleSection({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`eunoia-doodle-section ${className}`}>
      <img className="eunoia-doodle-bg" src={assets.doodles} alt="" />
      {children}
    </section>
  );
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="eunoia-landing">
      <ScrollProgress className="h-[3px] bg-linear-to-r from-[#6965DB] via-[#9E7AFF] to-[#ffb005]" />
      {/* Header Navigation */}
      <header className="eunoia-header">
        <a className="eunoia-logo" href="#top">
          <svg
            width="32"
            height="32"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect width="32" height="32" rx="8" fill="#6965DB" />
            <path
              d="M9 16H23M16 9V23M11 11L21 21M21 11L11 21"
              stroke="#FFFFFF"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          <DiaTextReveal text="Eunoia" />
        </a>

        <nav
          className={`eunoia-nav ${menuOpen ? 'eunoia-nav--open' : ''}`}
          aria-label="Main navigation"
        >
          <a href="#pricing">Plans</a>
          <a href="#teams">Workspaces</a>
          <a href="#roadmap">Changelog</a>
          <a href="#resources">
            Docs <ChevronDown size={16} />
          </a>
        </nav>

        <div className="eunoia-actions">
          <a
            className="eunoia-nav-icon"
            href="#resources"
            aria-label="Eunoia community"
          >
            <MessageCircle size={17} />
          </a>
          <a className="eunoia-nav-github" href="#resources">
            <Github size={16} /> Open core
          </a>
          <a className="eunoia-sign-in" href="#teams">
            Sign in
          </a>
          <ShimmerButton
            type="button"
            onClick={() => scrollToSection('#resources')}
          >
            Open workspace
          </ShimmerButton>
          <button className="eunoia-language" type="button">
            <Globe2 size={16} /> EN <ChevronDown size={15} />
          </button>
          <button
            className="eunoia-mobile-menu"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main id="top">
        {/* Hero Section — CSS dot grid + TextAnimate + ShinyText + Safari + Tickers + Avatars */}
        <DoodleSection className="eunoia-hero !min-h-0 !pb-16">
          <div className="eunoia-dot-grid" aria-hidden="true" />
          <div className="eunoia-hero__copy flex flex-col items-center">
            <BlurFade inView>
              <a
                href="#resources"
                className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#6965DB]/25 bg-white/80 px-4 py-1.5 text-[13px] font-bold text-[#292359] shadow-sm backdrop-blur transition hover:border-[#6965DB]/50"
              >
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                </span>
                <AnimatedShinyText className="text-[13px] font-bold text-[#292359]">
                  Open core · D2 native · sub-50ms sync
                </AnimatedShinyText>
                <ArrowRight size={14} />
              </a>
            </BlurFade>
            <TextAnimate
              as="h1"
              by="word"
              animation="blurInUp"
              startOnView
              once
              className="eunoia-hero-title"
            >
              Architecture Whiteboard made simple
            </TextAnimate>
            <BlurFade delay={0.25} inView>
              <p className="!mt-6 flex flex-wrap items-baseline justify-center gap-x-2">
                <WordRotate
                  words={['Sketch,', 'Diagram,', 'Decide.']}
                  duration={2200}
                  className="font-hand text-[24px] text-[#6965DB]"
                />
                <span>Simply with Eunoia.</span>
              </p>
            </BlurFade>
            <BlurFade delay={0.35} inView>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <CoolMode options={pencilBurst}>
                  <ShimmerButton
                    type="button"
                    className="px-8 py-3.5 text-[15px]"
                    background="rgba(105,101,219,1)"
                    onClick={() => scrollToSection('#resources')}
                  >
                    Open a room <ArrowRight size={16} />
                  </ShimmerButton>
                </CoolMode>
                <a
                  href="#resources"
                  className="eunoia-button eunoia-button--secondary"
                >
                  <Github size={16} /> Star on GitHub
                </a>
              </div>
            </BlurFade>
            <BlurFade delay={0.45} inView>
              <div className="mt-7 flex flex-col items-center gap-2">
                <AvatarCircles avatarUrls={avatars} numPeople={2400} />
                <p className="!m-0 text-[13px] font-semibold text-[#4c4a69]">
                  Loved by 2,400+ engineers mapping systems in the open
                </p>
              </div>
            </BlurFade>
          </div>
        </DoodleSection>

        {/* Hero product shot + live stats */}
        <section className="relative bg-white px-6 pb-4">
          <BlurFade delay={0.1} inView className="relative mx-auto max-w-5xl">
            <div className="relative rounded-xl">
              <Safari
                url="app.eunoia.dev/workspace"
                imageSrc={assets.playground}
                className="rounded-xl shadow-[0_32px_64px_-16px_rgba(74,71,106,0.3)]"
              />
              <BorderBeam
                size={120}
                duration={7}
                colorFrom="#6965DB"
                colorTo="#ffb005"
                borderWidth={2}
              />
            </div>
            <div
              aria-hidden="true"
              className="absolute -top-10 -right-4 hidden size-28 rotate-[-8deg] place-items-center rounded-full border-2 border-dashed border-[#6965DB]/40 bg-[#fff4c9] shadow-md md:grid"
            >
              <SpinningText
                duration={14}
                radius={4.2}
                className="font-hand text-[13px] font-bold text-[#17174a]"
              >
                open core · d2 native ·
              </SpinningText>
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-lg">
                ✏️
              </span>
            </div>
          </BlurFade>
          <BlurFade delay={0.2} inView>
            <div className="mx-auto mt-10 grid max-w-5xl grid-cols-2 gap-3 pb-10 sm:grid-cols-4">
              {[
                {
                  value: 60,
                  suffix: ' FPS',
                  label: 'pan & zoom at 3,000+ shapes',
                },
                {
                  value: 50,
                  prefix: '<',
                  suffix: 'ms',
                  label: 'peer sync via Yjs CRDTs',
                },
                { value: 3000, suffix: '+', label: 'native vector objects' },
                {
                  value: 500,
                  prefix: '<',
                  suffix: 'ms',
                  label: 'D2 compile + render',
                },
              ].map((s) => (
                <MagicCard
                  key={s.label}
                  className="rounded-2xl p-4 text-center"
                  gradientColor="#6965DB"
                  gradientOpacity={0.12}
                >
                  <p className="text-3xl font-extrabold tracking-tight text-[#15154c]">
                    {s.prefix}
                    <NumberTicker
                      value={s.value}
                      className="text-3xl font-extrabold text-[#15154c]"
                    />
                    {s.suffix}
                  </p>
                  <p className="mt-1 text-[13px] font-semibold text-[#4c4a69]">
                    {s.label}
                  </p>
                </MagicCard>
              ))}
            </div>
          </BlurFade>
        </section>

        {/* Company Strip — scroll-reactive velocity marquee */}
        <section className="eunoia-company-strip !pb-14">
          <BlurFade inView>
            <p>Made for teams who map what matters</p>
          </BlurFade>
          <ScrollVelocityContainer>
            <ScrollVelocityRow baseVelocity={2.5}>
              {companies.map((c) => (
                <span
                  key={c}
                  className="mx-5 whitespace-nowrap font-sans text-[22px] font-extrabold tracking-tight text-[#b9b9bf] grayscale transition hover:text-[#6965DB] hover:grayscale-0"
                >
                  {c}
                </span>
              ))}
            </ScrollVelocityRow>
          </ScrollVelocityContainer>
        </section>

        {/* Intro Section */}
        <DoodleSection className="eunoia-intro">
          <div className="eunoia-intro__copy">
            <BlurFade inView>
              <h2>
                Say hi to{' '}
                <em>
                  <strong>Eunoia</strong>
                </em>
              </h2>
            </BlurFade>
            <BlurFade delay={0.1} inView>
              <h4>
                <em>
                  <strong>
                    Open core +{' '}
                    <Highlighter
                      action="highlight"
                      color="#FFE58A"
                      isView
                      animationDuration={700}
                    >
                      D2 native
                    </Highlighter>
                  </strong>
                </em>
              </h4>
            </BlurFade>
            <TextAnimate
              as="h6"
              by="word"
              animation="fadeIn"
              startOnView
              once
              className="eunoia-intro-sub"
            >
              Start with a room. Keep the system in view.
            </TextAnimate>
            <BlurFade delay={0.15} inView>
              <div className="eunoia-intro-buttons">
                <Button href="#resources">Open a room</Button>
                <Button kind="secondary" href="#resources">
                  Try D2 workspace
                </Button>
              </div>
            </BlurFade>
            <span className="eunoia-trial-note">
              ↙ <i>native objects, not images</i> ♥
            </span>
          </div>
        </DoodleSection>

        {/* Feature List */}
        <section className="eunoia-feature-list" id="resources">
          <FeatureStep
            icon={assets.bulb}
            tag="open core"
            title="Sketch the system"
            intro="Start loose, then give each idea a place. The infinite canvas keeps architecture decisions visible as the system grows."
          >
            <BlurFade delay={0.1} inView>
              <div className="eunoia-browser-stage">
                <Safari
                  url="app.eunoia.dev/workspace"
                  imageSrc={assets.playground}
                />
              </div>
            </BlurFade>
            <div className="eunoia-feature-cards eunoia-feature-cards--3">
              {[
                {
                  title: '✏️ Draw freely',
                  text: 'Get the first thought down quickly.',
                },
                {
                  title: '📖 Reusable patterns',
                  text: 'Keep trusted system shapes close.',
                },
                {
                  title: '✨ Native objects',
                  text: 'Select, move, and refine every part.',
                },
              ].map((card, i) => (
                <BlurFade key={card.title} delay={0.08 * i} inView>
                  <MagicCard
                    className="h-full rounded-[7px] p-[25px_23px]"
                    gradientOpacity={0.1}
                  >
                    <h5 className="m-0 text-[16px] font-bold text-[#242257]">
                      {card.title}
                    </h5>
                    <p className="mt-2 text-[15px] leading-[1.4] text-[#525172]">
                      {card.text}
                    </p>
                  </MagicCard>
                </BlurFade>
              ))}
            </div>
          </FeatureStep>

          <FeatureStep
            icon={assets.collab}
            tag="shared rooms"
            title="Think together"
            intro="Bring the team into one room, follow the same system map, and continue the conversation from the work itself."
          >
            <BlurFade delay={0.1} inView>
              <div className="my-10">
                <CollabBeamDemo />
              </div>
            </BlurFade>
            <div className="grid gap-3 sm:grid-cols-2">
              <BlurFade delay={0.05} inView>
                <MagicCard
                  className="h-full rounded-xl p-6"
                  gradientOpacity={0.1}
                >
                  <h5 className="m-0 text-[16px] font-bold text-[#242257]">
                    🔗 Room links
                  </h5>
                  <p className="mt-2 text-[15px] text-[#525172]">
                    Invite collaborators to the live canvas. Presence, cursors,
                    and undo stay per-user.
                  </p>
                </MagicCard>
              </BlurFade>
              <BlurFade delay={0.12} inView className="flex justify-center">
                <ActivityFeed />
              </BlurFade>
            </div>
          </FeatureStep>

          <FeatureStep
            icon={assets.target}
            tag="engineering canvases"
            title="Map the moving parts"
            intro="Architecture sessions, service maps, incident response, technical planning, and the systems behind them."
          >
            <div className="eunoia-feature-cards eunoia-feature-cards--3">
              {[
                {
                  title: 'Service map',
                  text: 'Make dependencies and boundaries easier to see.',
                  href: '#resources',
                },
                {
                  title: 'D2 diagram',
                  text: 'Turn declarative structure into editable canvas objects.',
                  href: '#resources',
                },
                {
                  title: 'Incident room',
                  text: 'Keep the live problem, owners, and next actions in one place.',
                  href: '#resources',
                },
              ].map((card, i) => (
                <BlurFade key={card.title} delay={0.08 * i} inView>
                  <MagicCard
                    className="h-full rounded-[7px]"
                    gradientOpacity={0.12}
                  >
                    <a
                      href={card.href}
                      className="eunoia-feature-card eunoia-feature-card--link !border-0"
                    >
                      <h5>{card.title}</h5>
                      <p>{card.text}</p>
                      <span>
                        Read it <ArrowRight size={16} />
                      </span>
                    </a>
                  </MagicCard>
                </BlurFade>
              ))}
            </div>
          </FeatureStep>

          <FeatureStep
            icon={assets.stars}
            tag="inside the canvas"
            title="D2, in the room"
            intro="Write diagram source beside the canvas and compile a clear structural view without breaking the thinking flow."
          >
            <BlurFade delay={0.1} inView>
              <div className="my-10 flex flex-col items-center justify-center gap-4 lg:flex-row lg:items-start">
                <RoomFileTree />
                <D2TerminalDemo />
              </div>
            </BlurFade>
            <div className="eunoia-feature-cards eunoia-feature-cards--2">
              {[
                {
                  title: '✏️ Code to canvas',
                  text: 'Build diagrams from D2 source, then edit the pieces.',
                },
                {
                  title: '▶️ Safe compile feedback',
                  text: 'Keep the last valid system view while you work.',
                },
              ].map((card, i) => (
                <BlurFade key={card.title} delay={0.08 * i} inView>
                  <MagicCard
                    className="h-full rounded-[7px] p-[25px_23px]"
                    gradientOpacity={0.1}
                  >
                    <h5 className="m-0 text-[16px] font-bold text-[#242257]">
                      {card.title}
                    </h5>
                    <p className="mt-2 text-[15px] text-[#525172]">
                      {card.text}
                    </p>
                  </MagicCard>
                </BlurFade>
              ))}
            </div>
          </FeatureStep>

          <FeatureStep
            icon={assets.hand}
            tag="no busywork"
            title="A clearer way to explain a system"
            intro="Use visual thinking for the parts that need a room: questions, relationships, trade-offs, and what comes next."
            last
          >
            <div className="eunoia-feature-cards eunoia-feature-cards--2">
              {[
                {
                  title: 'Canvas-first',
                  text: 'Keep tools available without covering the work.',
                },
                {
                  title: 'Export-ready',
                  text: 'Carry the shared understanding into the next conversation.',
                },
              ].map((card, i) => (
                <BlurFade key={card.title} delay={0.08 * i} inView>
                  <MagicCard
                    className="h-full rounded-[7px] p-[25px_23px]"
                    gradientOpacity={0.1}
                  >
                    <h5 className="m-0 text-[16px] font-bold text-[#242257]">
                      {card.title}
                    </h5>
                    <p className="mt-2 text-[15px] text-[#525172]">
                      {card.text}
                    </p>
                  </MagicCard>
                </BlurFade>
              ))}
            </div>
          </FeatureStep>
        </section>

        {/* Under the hood — open plumbing, orbiting the product */}
        <section className="mx-auto max-w-5xl px-6 pb-24 text-center">
          <BlurFade inView>
            <span className="eunoia-drawn-label">open plumbing</span>
            <TextAnimate
              as="h2"
              by="word"
              animation="blurInUp"
              startOnView
              once
              className="eunoia-section-title"
            >
              Boring tech, kept in orbit
            </TextAnimate>
            <p className="mx-auto mt-4 max-w-xl text-[17px] font-medium text-[#4c4a69]">
              No black boxes.{' '}
              <Highlighter
                action="underline"
                color="#6965DB"
                strokeWidth={2.5}
                isView
              >
                Declarative diagrams, CRDT sync, real persistence
              </Highlighter>{' '}
              — every layer inspectable.
            </p>
          </BlurFade>
          <BlurFade delay={0.15} inView>
            <TechOrbit />
          </BlurFade>
        </section>

        {/* Whiteboard Callout — CSS dot grid + Shimmer */}
        <section className="eunoia-whiteboard-callout">
          <div className="eunoia-dot-grid" aria-hidden="true" />
          <img className="callout-bg" src={assets.doodles} alt="" />
          <BlurFade inView>
            <div className="eunoia-whiteboard-callout__content">
              <img className="callout-icon" src={assets.logoIcon} alt="" />
              <h2>
                Architecture{' '}
                <em>
                  <strong>whiteboard</strong>
                </em>
              </h2>
              <p>Something complex on your mind? Start mapping it.</p>
              <div className="eunoia-whiteboard-callout__buttons">
                <ShimmerButton
                  type="button"
                  background="rgba(105,101,219,1)"
                  className="px-8 py-3"
                  onClick={() => scrollToSection('#teams')}
                >
                  Open a room <ArrowRight size={16} />
                </ShimmerButton>
                <Button kind="secondary" href="#resources">
                  Try the D2 workspace
                </Button>
              </div>
              <span className="eunoia-whiteboard-callout__subtext">
                Keep the context, not just the screenshot
              </span>
            </div>
          </BlurFade>
        </section>

        {/* Testimonials */}
        <section className="eunoia-testimonials" id="teams">
          <BlurFade inView>
            <div className="eunoia-testimonials__heading">
              <TextAnimate
                as="h2"
                by="word"
                animation="blurInUp"
                startOnView
                once
              >
                Designed for shared clarity
              </TextAnimate>
              <p>
                Make the working state of a technical conversation easier to
                understand.
              </p>
            </div>
          </BlurFade>
          <div className="eunoia-testimonials__grid">
            {[
              {
                title: 'Keep the room human',
                small: 'Canvas before ceremony',
                text: 'Sketch first, then add structure exactly where the discussion needs it.',
              },
              {
                title: 'Keep state visible',
                small: 'Connected, compiling, saved',
                text: 'Clear feedback helps the team understand what changed and what remains safe.',
              },
              {
                title: 'Keep outputs useful',
                small: 'PNG, SVG, JSON',
                text: 'Take the board into documentation, planning, and the next decision.',
              },
            ].map((t, i) => (
              <BlurFade key={t.title} delay={0.1 * i} inView>
                <MagicCard
                  className="h-full rounded-[8px] p-[25px]"
                  gradientOpacity={0.12}
                >
                  <h3 className="m-0 text-[16px] text-[#252356]">
                    {t.title}{' '}
                    <small className="mt-1 block text-[12px] font-medium text-[#77758a]">
                      {t.small}
                    </small>
                  </h3>
                  <p className="mt-[21px] text-[15px] leading-[1.5] text-[#454361]">
                    {t.text}
                  </p>
                </MagicCard>
              </BlurFade>
            ))}
          </div>
        </section>

        {/* More Reference / Pricing Plans */}
        <section className="eunoia-more-plans" id="pricing">
          <BlurFade inView>
            <TextAnimate
              as="h2"
              by="word"
              animation="blurInUp"
              startOnView
              once
            >
              Choose your canvas
            </TextAnimate>
          </BlurFade>
          <div className="eunoia-more-plans__cards">
            <BlurFade delay={0.05} inView>
              <MagicCard
                className="h-full rounded-[13px] p-[39px]"
                gradientOpacity={0.08}
              >
                <span className="font-hand text-[21px] text-[#6965DB]">
                  Community
                </span>
                <h3>Draw and map systems in the open</h3>
                <p>
                  Start with a flexible architecture canvas for spatial
                  thinking, clear diagrams, and local workflows.
                </p>
                <Button href="#resources">Explore community</Button>
              </MagicCard>
            </BlurFade>
            <BlurFade delay={0.15} inView>
              <MagicCard
                className="h-full rounded-[13px] !border-[#cbc8fa] p-[39px]"
                gradientColor="#6965DB"
                gradientOpacity={0.18}
              >
                <span className="font-hand text-[21px] text-[#6965DB]">
                  Workspace
                </span>
                <h3>Give every team conversation a home</h3>
                <p>
                  Bring rooms, team presence, D2 source, managed history, and
                  dependable exports into the same shared space.
                </p>
                <Button href="#resources">Open workspace</Button>
              </MagicCard>
            </BlurFade>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="eunoia-footer">
        <div className="footer-logo">
          <svg
            width="24"
            height="24"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect width="32" height="32" rx="6" fill="#6965DB" />
            <path
              d="M9 16H23M16 9V23M11 11L21 21M21 11L11 21"
              stroke="#FFFFFF"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          <span>Eunoia</span>
        </div>
        <span>Eunoia Architecture Whiteboard</span>
        <span>Workspace</span>
      </footer>
    </div>
  );
}

export default LandingPage;
