'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { loadSession } from '@/lib/whiteboard/auth';
import { formatBillingAmount } from '@/lib/whiteboard/billing-format';
import {
  fetchPrices,
  createCheckoutSession,
  PlanInfo,
} from '@/lib/whiteboard/billing-api';
import { Check, ArrowRight } from 'lucide-react';
import './pricing.css';

export function PricingPage() {
  const router = useRouter();
  const [session] = useState(() => loadSession());
  // Session storage doesn't exist during SSR (server always renders
  // signed-out). Gate session-dependent UI behind mount so hydration
  // matches; logic handlers keep reading the session synchronously.
  const [mounted, setMounted] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot hydration gate, not a render loop. */
  useEffect(() => {
    setMounted(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  const [seats, setSeats] = useState(1);
  const [prices, setPrices] = useState<PlanInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPrices()
      .then((res) => setPrices(res.prices))
      .catch(() => {
        // Fallback default prices if server is reachable without explicit pricing API
        setPrices([
          { key: 'pro', name: 'Pro', pricePerSeat: 50_000, currency: 'inr' },
        ]);
      });
  }, []);

  const handleUpgrade = async () => {
    const currentSession = loadSession();
    if (!currentSession) {
      // AuthForm honors ?next= (not ?redirect=).
      router.push('/login?next=/pricing');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await createCheckoutSession(
        'pro',
        seats,
        currentSession.token,
      );
      if (res.url) {
        window.location.href = res.url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setLoading(false);
    }
  };

  const proPrice = prices.find((p) => p.key === 'pro');
  const priceDisplay = proPrice
    ? formatBillingAmount(proPrice.pricePerSeat, proPrice.currency)
    : formatBillingAmount(50_000, 'INR');

  return (
    <div className="eunoia-pricing min-h-screen flex flex-col font-sans">
      {/* Header / Nav */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between max-w-7xl mx-auto w-full">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-md bg-[#2458a6] flex items-center justify-center font-medium text-white">
            E
          </div>
          <span className="font-medium text-lg tracking-tight">
            Eunoia
          </span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {mounted && session ? (
            <Link
              href="/billing"
              className="pricing-nav-link"
            >
              Manage Subscription
            </Link>
          ) : (
            <Link
              href="/login?next=/pricing"
              className="pricing-nav-link"
            >
              Sign In
            </Link>
          )}
          <Link
            href="/board"
            className="pricing-nav-cta"
          >
            Open Workspace
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-7xl mx-auto px-6 py-16 w-full flex flex-col items-center">
        <div className="pricing-intro text-center max-w-3xl mb-16 space-y-4">
          <div className="pricing-eyebrow">
            Plans and pricing
          </div>
          <h1 className="text-4xl sm:text-5xl font-medium tracking-tight leading-tight">
            Choose the right canvas for your team
          </h1>
          <p className="text-lg text-white/60">
            Scale from personal diagramming to enterprise-grade system
            architecture whiteboarding.
          </p>
        </div>

        {error && (
          <div className="w-full max-w-md mb-8 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm text-center">
            {error}
          </div>
        )}

        {/* Pricing Cards Grid */}
        <div className="pricing-grid grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-6xl">
          {/* Community Tier */}
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-8 flex flex-col justify-between hover:border-white/20 transition-all">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">Community</h3>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-white/10 text-white/70">
                  Open Source
                </span>
              </div>
              <p className="text-sm text-white/50 mb-6 min-h-[40px]">
                Draw and map systems in the open with standard DAGRE layout
                engine.
              </p>
              <div className="mb-6">
                <span className="text-4xl font-extrabold text-white">$0</span>
                <span className="text-white/50 text-sm font-normal">
                  {' '}
                  / forever
                </span>
              </div>
              <ul className="space-y-3 text-sm text-white/80 border-t border-white/10 pt-6">
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" />{' '}
                  Infinite Whiteboard Canvas
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" /> D2
                  DAGRE Layout Engine
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" /> Up
                  to 30 nodes per diagram
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" />{' '}
                  Standard PNG exports
                </li>
              </ul>
            </div>
            <Link
              href="/board"
              className="mt-8 w-full py-3 px-4 rounded-xl border border-white/20 hover:bg-white/10 text-white font-medium text-center transition-colors text-sm"
            >
              Get Started Free
            </Link>
          </div>

          {/* Pro Tier (Featured) */}
          <div className="rounded-2xl bg-gradient-to-b from-[#2458a6]/20 via-white/[0.05] to-white/[0.02] border-2 border-[#2458a6] p-8 flex flex-col justify-between relative shadow-2xl shadow-[#2458a6]/20 scale-105">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-medium flex items-center gap-2">
                  Pro
                </h3>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#2458a6]/30 text-[#344b66]">
                  Per-seat
                </span>
              </div>
              <p className="text-sm text-white/60 mb-6 min-h-[40px]">
                Use advanced ELK & TALA layout engines, higher node limits, and
                team collaboration.
              </p>
              <div className="mb-6">
                <span className="text-4xl font-extrabold text-white">
                  {priceDisplay}
                </span>
                <span className="text-white/50 text-sm font-normal">
                  {' '}
                  / seat / month
                </span>
              </div>

              {/* Seat Selector */}
              <div className="bg-white/5 p-3 rounded-xl border border-white/10 mb-6 flex items-center justify-between">
                <span className="text-xs font-medium text-white/70">
                  Number of seats:
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSeats(Math.max(1, seats - 1))}
                    className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm font-bold transition-colors"
                  >
                    -
                  </button>
                  <span className="w-8 text-center font-bold text-sm text-white">
                    {seats}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSeats(seats + 1)}
                    className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm font-bold transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              <ul className="space-y-3 text-sm text-white/90 border-t border-white/10 pt-6">
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" />{' '}
                  Everything in Community
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" />{' '}
                  Advanced ELK & TALA Layout Engines
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" />{' '}
                  Unlimited D2 diagram node count
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" />{' '}
                  Team Rooms & Managed History
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" />{' '}
                  High-res vector & image exports
                </li>
              </ul>
            </div>
            <button
              type="button"
              onClick={handleUpgrade}
              disabled={loading}
              className="mt-8 w-full py-3.5 px-4 rounded-xl bg-[#2458a6] hover:bg-[#1d477f] text-white font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#2458a6]/30 disabled:opacity-50"
            >
              {loading ? (
                <span>Redirecting...</span>
              ) : (
                <>
                  <span>
                    Upgrade to Pro ({seats} seat{seats > 1 ? 's' : ''})
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {/* Enterprise Tier */}
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-8 flex flex-col justify-between hover:border-white/20 transition-all">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">Enterprise</h3>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-white/10 text-white/70">
                  Custom
                </span>
              </div>
              <p className="text-sm text-white/50 mb-6 min-h-[40px]">
                Custom SLAs, dedicated database isolation, SSO, and audit
                logging.
              </p>
              <div className="mb-6">
                <span className="text-4xl font-extrabold text-white">
                  Custom
                </span>
              </div>
              <ul className="space-y-3 text-sm text-white/80 border-t border-white/10 pt-6">
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" />{' '}
                  Everything in Pro
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" />{' '}
                  DB-Managed Tier Overrides
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" /> SSO
                  / SAML Authentication
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" />{' '}
                  Dedicated Cloud Infrastructure
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#2458a6] flex-shrink-0" />{' '}
                  Priority 24/7 SLA Support
                </li>
              </ul>
            </div>
            <a
              href="mailto:enterprise@eunoia.dev"
              className="mt-8 w-full py-3 px-4 rounded-xl border border-white/20 hover:bg-white/10 text-white font-medium text-center transition-colors text-sm block"
            >
              Contact Sales
            </a>
          </div>
        </div>

        {/* Feature comparison guarantee */}
      </main>
    </div>
  );
}
