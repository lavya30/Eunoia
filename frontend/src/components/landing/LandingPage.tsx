'use client';
import { ShimmerButton } from "@/components/ui/shimmer-button"
import React, { useState, type ReactNode } from 'react';
import { DiaTextReveal } from "@/components/ui/dia-text-reveal"
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

function BrowserFrame({ poster, label }: { poster?: string; label: string }) {
  return (
    <div className="eunoia-browser-stage">
      <div className="eunoia-browser-frame">
        <div className="eunoia-browser-frame__bar">
          <div className="eunoia-browser-dots">
            <i />
            <i />
            <i />
          </div>
          <div className="eunoia-browser-address">
            <span>app.eunoia.dev/workspace</span>
          </div>
        </div>
        {poster ? (
          <img className="eunoia-browser-poster" src={poster} alt={label} />
        ) : (
          <div
            style={{
              width: '100%',
              aspectRatio: '16 / 8.7',
              backgroundColor: '#0d0d0d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#8c8b9f',
              fontSize: '14px',
              fontFamily: "'Inter', monospace",
              backgroundImage:
                'radial-gradient(circle, #222 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          >
            <span>{label}</span>
          </div>
        )}
      </div>
      <span className="eunoia-browser-halo" aria-hidden="true" />
    </div>
  );
}

function FeatureStep({
  icon,
  tag,
  title,
  intro,
  poster,
  cards,
  last = false,
}: {
  icon: string;
  tag: string;
  title: string;
  intro: string;
  poster?: string;
  cards: { title: string; text: string; href?: string }[];
  last?: boolean;
}) {
  return (
    <article
      className={`eunoia-feature-step ${
        last ? 'eunoia-feature-step--last' : ''
      }`}
    >
      <div className="eunoia-feature-rail" aria-hidden="true">
        <img src={icon} alt="" />
      </div>
      <span className="eunoia-drawn-label">{tag}</span>
      <h2>{title}</h2>
      <h4>{intro}</h4>
      <BrowserFrame poster={poster} label={`${title} demonstration`} />
      <div
        className={`eunoia-feature-cards eunoia-feature-cards--${cards.length}`}
      >
        {cards.map((card) =>
          card.href ? (
            <a
              key={card.title}
              href={card.href}
              className="eunoia-feature-card eunoia-feature-card--link"
            >
              <h5>{card.title}</h5>
              <p>{card.text}</p>
              <span>
                Read it <ArrowRight size={16} />
              </span>
            </a>
          ) : (
            <div key={card.title} className="eunoia-feature-card">
              <h5>{card.title}</h5>
              <p>{card.text}</p>
            </div>
          ),
        )}
      </div>
    </article>
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
          <ShimmerButton href="#resources">Open workspace</ShimmerButton>
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
        {/* Hero Section */}
        <DoodleSection className="eunoia-hero">
          <div className="eunoia-hero__copy">
            <h1>
              Architecture{' '}
              <em>
                <strong>Whiteboard</strong>
              </em>{' '}
              made simple
            </h1>
            <p>Sketch, Diagram, Decide. Simply with Eunoia.</p>
            <a className="eunoia-github-pill" href="#resources">
              <Github size={17} />
              Open core on GitHub
            </a>
          </div>
          <img
            className="eunoia-hero-pen"
            src={assets.pen}
            alt="Hand-drawn pen nib"
          />
        </DoodleSection>

        {/* Company Strip */}
        <section className="eunoia-company-strip">
          <p>Made for teams who map what matters</p>
          <div className="eunoia-company-track">
            <span>NETFLIX</span>
            <span>Meta</span>
            <span>Intel</span>
            <span>CAPCO</span>
            <span>Wix</span>
            <span>Swappie</span>
            <span>reddit</span>
            <span>WIX</span>
            <span>campings.com</span>
            <span>Memfault</span>
            <span>BLUEBEAM</span>
            <span>ROKT</span>
          </div>
        </section>

        {/* Intro Section */}
        <DoodleSection className="eunoia-intro">
          <div className="eunoia-intro__copy">
            <h2>
              Say hi to{' '}
              <em>
                <strong>Eunoia</strong>
              </em>
            </h2>
            <h4>
              <em>
                <strong>Open core + D2 native</strong>
              </em>
            </h4>
            <h6>Start with a room. Keep the system in view.</h6>
            <div className="eunoia-intro-buttons">
              <Button href="#resources">Open a room</Button>
              <Button kind="secondary" href="#resources">
                Try D2 workspace
              </Button>
            </div>
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
            poster={assets.playground}
            cards={[
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
            ]}
          />

          <FeatureStep
            icon={assets.collab}
            tag="shared rooms"
            title="Think together"
            intro="Bring the team into one room, follow the same system map, and continue the conversation from the work itself."
            poster={assets.playground}
            cards={[
              {
                title: '🔗 Room links',
                text: 'Invite collaborators to the live canvas.',
              },
              {
                title: '🔐 Clear context',
                text: 'Share the architecture without losing the thread.',
              },
            ]}
          />

          <FeatureStep
            icon={assets.target}
            tag="engineering canvases"
            title="Map the moving parts"
            intro="Architecture sessions, service maps, incident response, technical planning, and the systems behind them."
            poster={assets.playground}
            cards={[
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
            ]}
          />

          <FeatureStep
            icon={assets.stars}
            tag="inside the canvas"
            title="D2, in the room"
            intro="Write diagram source beside the canvas and compile a clear structural view without breaking the thinking flow."
            poster={assets.playground}
            cards={[
              {
                title: '✏️ Code to canvas',
                text: 'Build diagrams from D2 source, then edit the pieces.',
              },
              {
                title: '▶️ Safe compile feedback',
                text: 'Keep the last valid system view while you work.',
              },
            ]}
          />

          <FeatureStep
            icon={assets.hand}
            tag="no busywork"
            title="A clearer way to explain a system"
            intro="Use visual thinking for the parts that need a room: questions, relationships, trade-offs, and what comes next."
            poster={assets.playground}
            cards={[
              {
                title: 'Canvas-first',
                text: 'Keep tools available without covering the work.',
              },
              {
                title: 'Export-ready',
                text: 'Carry the shared understanding into the next conversation.',
              },
            ]}
            last
          />
        </section>

        {/* Whiteboard Callout */}
        <section className="eunoia-whiteboard-callout">
          <img className="callout-bg" src={assets.doodles} alt="" />
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
              <Button href="#resources">Open a room</Button>
              <Button kind="secondary" href="#resources">
                Try the D2 workspace
              </Button>
            </div>
            <span className="eunoia-whiteboard-callout__subtext">
              Keep the context, not just the screenshot
            </span>
          </div>
        </section>

        {/* Testimonials */}
        <section className="eunoia-testimonials" id="teams">
          <div className="eunoia-testimonials__heading">
            <h2>Designed for shared clarity</h2>
            <p>
              Make the working state of a technical conversation easier to
              understand.
            </p>
          </div>
          <div className="eunoia-testimonials__grid">
            <article>
              <h3>
                Keep the room human <small>Canvas before ceremony</small>
              </h3>
              <p>
                Sketch first, then add structure exactly where the discussion
                needs it.
              </p>
            </article>
            <article>
              <h3>
                Keep state visible <small>Connected, compiling, saved</small>
              </h3>
              <p>
                Clear feedback helps the team understand what changed and what
                remains safe.
              </p>
            </article>
            <article>
              <h3>
                Keep outputs useful <small>PNG, SVG, JSON</small>
              </h3>
              <p>
                Take the board into documentation, planning, and the next
                decision.
              </p>
            </article>
          </div>
        </section>

        {/* More Reference / Pricing Plans */}
        <section className="eunoia-more-plans" id="pricing">
          <h2>Choose your canvas</h2>
          <div className="eunoia-more-plans__cards">
            <article>
              <span>Community</span>
              <h3>Draw and map systems in the open</h3>
              <p>
                Start with a flexible architecture canvas for spatial thinking,
                clear diagrams, and local workflows.
              </p>
              <Button href="#resources">Explore community</Button>
            </article>
            <article>
              <span>Workspace</span>
              <h3>Give every team conversation a home</h3>
              <p>
                Bring rooms, team presence, D2 source, managed history, and
                dependable exports into the same shared space.
              </p>
              <Button href="#resources">Open workspace</Button>
            </article>
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
