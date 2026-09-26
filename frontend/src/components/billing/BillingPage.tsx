'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, loadSession } from '@/lib/whiteboard/auth';
import {
  fetchSubscription,
  createPortalSession,
  SubscriptionData,
} from '@/lib/whiteboard/billing-api';
import {
  CreditCard,
  CheckCircle2,
  ExternalLink,
  ArrowLeft,
  User,
} from 'lucide-react';

export function BillingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [session] = useState(() => loadSession());
  const [subscription, setSubscription] = useState<SubscriptionData | null>(
    null,
  );
  const [userTier, setUserTier] = useState<string>('COMMUNITY');
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);

  const isCheckoutSuccess =
    searchParams.get('checkout') === 'success' ||
    searchParams.get('success') === 'true';

  useEffect(() => {
    const currentSession = loadSession();
    if (!currentSession) {
      // AuthForm honors ?next= (not ?redirect=): a mismatched param drops
      // the destination and lands the user on /board after sign-in.
      router.push('/login?next=/billing');
      return;
    }

    fetchSubscription(currentSession.token)
      .then((res) => {
        setSubscription(res.subscription);
        setUserTier(res.userTier || currentSession.user.tier || 'COMMUNITY');
      })
      .catch((err) => {
        // Expired/revoked tokens must offer a way forward, not a dead end.
        if (err instanceof ApiError && err.status === 401) {
          setAuthFailed(true);
          setError('Your sign-in expired. Sign in again to manage billing.');
        } else {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load subscription details',
          );
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [router]);

  const handleManagePortal = async () => {
    const currentSession = loadSession();
    if (!currentSession) {
      router.push('/login?next=/billing');
      return;
    }
    setPortalLoading(true);
    setError(null);
    try {
      const res = await createPortalSession(currentSession.token);
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      // A missing URL is a failure, not a hang: release the button.
      setError('The payment portal did not return a link. Try again.');
      setPortalLoading(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthFailed(true);
        setError('Your sign-in expired. Sign in again to manage billing.');
      } else {
        setError(
          err instanceof Error ? err.message : 'Could not open customer portal',
        );
      }
      setPortalLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0c1d] text-white flex flex-col font-sans selection:bg-[#6965DB]/30">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between max-w-5xl mx-auto w-full">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-lg bg-[#6965DB] flex items-center justify-center font-bold text-white shadow-lg shadow-[#6965DB]/30 group-hover:scale-105 transition-transform">
            E
          </div>
          <span className="font-bold text-lg tracking-tight text-white/90">
            Eunoia
          </span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href="/pricing"
            className="text-white/70 hover:text-white transition-colors"
          >
            View Plans
          </Link>
          <Link
            href="/board"
            className="bg-[#6965DB] hover:bg-[#5854c7] text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm"
          >
            Open Workspace
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-4xl mx-auto px-6 py-12 w-full">
        <Link
          href="/board"
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Whiteboard
        </Link>

        {isCheckoutSuccess && (
          <div className="mb-8 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm flex items-center gap-3 shadow-lg">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <div>
              <p className="font-bold">Upgrade successful!</p>
              <p className="text-emerald-300/80 text-xs">
                Your account has been upgraded to Pro. Full compiler power is
                now active.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-8 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-center gap-3 flex-wrap">
            <span>{error}</span>
            {authFailed ? (
              <Link
                href="/login?next=/billing"
                className="py-1.5 px-4 rounded-lg bg-[#6965DB] hover:bg-[#5854c7] text-white font-medium text-xs transition-colors"
              >
                Sign in
              </Link>
            ) : null}
          </div>
        )}

        <div className="space-y-8">
          {/* Account & Billing Overview Card */}
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-8 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
              <div>
                <h1 className="text-2xl font-extrabold text-white flex items-center gap-3">
                  <CreditCard className="w-6 h-6 text-[#6965DB]" /> Subscription
                  & Billing
                </h1>
                <p className="text-sm text-white/60 mt-1">
                  Manage your subscription tier, seats, and payment portal
                  details.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/50">Current Tier:</span>
                <span
                  className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider ${
                    userTier === 'PRO'
                      ? 'bg-[#6965DB] text-white shadow-md shadow-[#6965DB]/30'
                      : userTier === 'ENTERPRISE'
                        ? 'bg-amber-500 text-black font-extrabold'
                        : 'bg-white/10 text-white/80'
                  }`}
                >
                  {userTier}
                </span>
              </div>
            </div>

            {loading ? (
              <div className="py-12 text-center text-white/50 text-sm">
                Loading subscription details...
              </div>
            ) : (
              <div className="pt-6 space-y-6">
                {/* Account Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                    <span className="text-xs text-white/50 block mb-1">
                      Account Email
                    </span>
                    <span className="text-sm font-semibold text-white flex items-center gap-2">
                      <User className="w-4 h-4 text-white/60" />{' '}
                      {session?.user.email}
                    </span>
                  </div>
                  <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                    <span className="text-xs text-white/50 block mb-1">
                      Plan Status
                    </span>
                    <span className="text-sm font-semibold text-emerald-400 capitalize">
                      {subscription?.status ??
                        (userTier === 'COMMUNITY' ? 'Free Tier' : 'Active')}
                    </span>
                  </div>
                </div>

                {/* Subscription Details if active */}
                {subscription && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                      <span className="text-xs text-white/50 block mb-1">
                        Seats Allocated
                      </span>
                      <span className="text-sm font-semibold text-white">
                        {subscription.seats} seat
                        {subscription.seats > 1 ? 's' : ''}
                      </span>
                    </div>
                    {subscription.periodEnd && (
                      <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                        <span className="text-xs text-white/50 block mb-1">
                          Renews / Ends On
                        </span>
                        <span className="text-sm font-semibold text-white">
                          {new Date(
                            subscription.periodEnd,
                          ).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="pt-4 flex flex-wrap items-center gap-4 border-t border-white/10">
                  {subscription?.customerId ? (
                    <button
                      type="button"
                      onClick={handleManagePortal}
                      disabled={portalLoading}
                      className="py-2.5 px-5 rounded-xl bg-[#6965DB] hover:bg-[#5854c7] text-white font-medium text-sm transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
                    >
                      <span>
                        {portalLoading
                          ? 'Opening Portal...'
                          : 'Manage Payment & Invoices'}
                      </span>
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  ) : (
                    <Link
                      href="/pricing"
                      className="py-2.5 px-5 rounded-xl bg-[#6965DB] hover:bg-[#5854c7] text-white font-medium text-sm transition-colors flex items-center gap-2 shadow-sm"
                    >
                      <span>Upgrade to Pro Plan</span>
                    </Link>
                  )}

                  <Link
                    href="/pricing"
                    className="py-2.5 px-5 rounded-xl border border-white/20 hover:bg-white/10 text-white font-medium text-sm transition-colors"
                  >
                    Compare All Plans
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
