'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { loadSession } from '@/lib/whiteboard/auth';
import {
  fetchPrices,
  createCheckoutSession,
  PlanInfo,
} from '@/lib/whiteboard/billing-api';
import { Check, Sparkles, ArrowRight, ShieldCheck, Zap } from 'lucide-react';

export function PricingPage() {
  const router = useRouter();
  const [session] = useState(() => loadSession());
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
          { key: 'pro', name: 'Pro', pricePerSeat: 1200, currency: 'usd' },
        ]);
      });
  }, []);

  const handleUpgrade = async () => {
    const currentSession = loadSession();
    if (!currentSession) {
      router.push('/login?redirect=/pricing');
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
    ? `$${(proPrice.pricePerSeat / 100).toFixed(0)}`
    : '$12';

  return (
    <div className="min-h-screen bg-[#0d0c1d] text-white flex flex-col font-sans selection:bg-[#6965DB]/30">
      {/* Header / Nav */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between max-w-7xl mx-auto w-full">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-lg bg-[#6965DB] flex items-center justify-center font-bold text-white shadow-lg shadow-[#6965DB]/30 group-hover:scale-105 transition-transform">
            E
          </div>
          <span className="font-bold text-lg tracking-tight text-white/90">
            Eunoia
          </span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {session ? (
            <Link
              href="/billing"
              className="text-white/70 hover:text-white transition-colors"
            >
              Manage Subscription
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-white/70 hover:text-white transition-colors"
            >
              Sign In
            </Link>
          )}
          <Link
            href="/board"
            className="bg-[#6965DB] hover:bg-[#5854c7] text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm"
          >
            Open Workspace
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-7xl mx-auto px-6 py-16 w-full flex flex-col items-center">
        <div className="text-center max-w-3xl mb-16 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#6965DB]/15 text-[#9491f2] border border-[#6965DB]/30 text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" /> Simple, Transparent Pricing
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-6xl">
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
                  <Check className="w-4 h-4 text-[#6965DB] flex-shrink-0" />{' '}
                  Infinite Whiteboard Canvas
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#6965DB] flex-shrink-0" /> D2
                  DAGRE Layout Engine
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#6965DB] flex-shrink-0" /> Up
                  to 30 nodes per diagram
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#6965DB] flex-shrink-0" />{' '}
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
          <div className="rounded-2xl bg-gradient-to-b from-[#6965DB]/20 via-white/[0.05] to-white/[0.02] border-2 border-[#6965DB] p-8 flex flex-col justify-between relative shadow-2xl shadow-[#6965DB]/20 scale-105">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#6965DB] text-white text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-lg">
              Most Popular
            </div>
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  Pro <Zap className="w-4 h-4 text-[#9491f2]" />
                </h3>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#6965DB]/30 text-[#c2c0f9]">
                  Per-seat
                </span>
              </div>
              <p className="text-sm text-white/60 mb-6 min-h-[40px]">
                Unlock advanced ELK & TALA layout engines, high node limits, and
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
                  <Check className="w-4 h-4 text-[#6965DB] flex-shrink-0" />{' '}
                  Everything in Community
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#9491f2] flex-shrink-0" />{' '}
                  Advanced ELK & TALA Layout Engines
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#9491f2] flex-shrink-0" />{' '}
                  Unlimited D2 diagram node count
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#9491f2] flex-shrink-0" />{' '}
                  Team Rooms & Managed History
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#9491f2] flex-shrink-0" />{' '}
                  High-res vector & image exports
                </li>
              </ul>
            </div>
            <button
              type="button"
              onClick={handleUpgrade}
              disabled={loading}
              className="mt-8 w-full py-3.5 px-4 rounded-xl bg-[#6965DB] hover:bg-[#5854c7] text-white font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#6965DB]/30 disabled:opacity-50"
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
                  <Check className="w-4 h-4 text-[#6965DB] flex-shrink-0" />{' '}
                  Everything in Pro
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#6965DB] flex-shrink-0" />{' '}
                  DB-Managed Tier Overrides
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#6965DB] flex-shrink-0" /> SSO
                  / SAML Authentication
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#6965DB] flex-shrink-0" />{' '}
                  Dedicated Cloud Infrastructure
                </li>
                <li className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-[#6965DB] flex-shrink-0" />{' '}
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
        <div className="mt-20 flex flex-wrap items-center justify-center gap-8 text-white/60 text-sm border-t border-white/10 pt-10 w-full max-w-4xl">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#6965DB]" /> Secure Stripe
            Checkout
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-[#6965DB]" /> Instant Pro Activation
          </div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#6965DB]" /> Cancel Anytime
          </div>
        </div>
      </main>
    </div>
  );
}
