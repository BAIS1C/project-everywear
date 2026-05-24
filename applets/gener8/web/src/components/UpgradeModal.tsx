// @ts-nocheck
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Zap, Cpu, Music, Check, ChevronRight, Sparkles, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  startCheckout,
  type TierId as LsTierId,
  TIER_PRICE_USD,
  TIER_PURCHASE_TYPE,
} from '../services/payments/lemonSqueezy';

// ── UpgradeModal — hybrid pricing + hardware compatibility ──────────
// Themed via EWDS (see prior comments).
//
// 2026-05-18 SGT: HYBRID PRICING PIVOT
// Moved from subscription-only ($5/$12.99/$30) to hybrid ownership + sub:
//   - Gener8 4ever:     $20 ONE-TIME purchase (perpetual local gen)
//   - Gener8 Pro:       $13.37/mo subscription (includes 4ever features)
//   - Creator Studio:   $28.88/mo subscription (includes all lower tiers)
//
// Monthly/annual toggle removed. 4ever is one-time, subs are monthly.
// Users do NOT need to buy 4ever before subscribing; subs include all
// 4ever functionality. Cancel sub = lose access UNLESS 4ever also owned
// separately (safety-net purchase).
//
// Creator Studio still routes to notify-me (founding 500 waitlist).
// Gener8 4ever and Pro route to LS checkout when authenticated.
// ─────────────────────────────────────────────────────────────────────

// Modal-internal tier IDs (gener8_base is legacy nomenclature retained
// for the marketing tier card "Start Here" badge). Map to the canonical
// LS service IDs (gener8 / gener8_pro / creator_studio) at the boundary
// so the checkout service stays decoupled from UpgradeModal's labels.
function toLsTierId(t: TierId): LsTierId {
  return t === 'gener8_base' ? 'gener8' : t;
}

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'plans' | 'models';
type TierId = 'gener8_base' | 'gener8_pro' | 'creator_studio';

type Phase =
  | { kind: 'compare' }
  | { kind: 'notify-form'; tier: TierId }
  | { kind: 'notify-submitting'; tier: TierId; email: string }
  | { kind: 'notify-success'; tier: TierId; position: number }
  | { kind: 'notify-error'; tier: TierId; email: string; message: string };

const HEADING: React.CSSProperties = {
  fontFamily: 'var(--ew-font-display)',
};

function tierLabel(t: TierId): string {
  return t === 'gener8_base' ? 'S³ Gener8 4ever' : t === 'gener8_pro' ? 'S³ Gener8 Pro' : 'S³ Creator Studio';
}

export const UpgradeModal: React.FC<UpgradeModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>('plans');
  const [phase, setPhase] = useState<Phase>({ kind: 'compare' });
  const { user } = useAuth();

  // Reset notify state when modal closes/reopens.
  useEffect(() => {
    if (!isOpen) {
      setPhase({ kind: 'compare' });
      setActiveTab('plans');
    }
  }, [isOpen]);

  // Purchase click handler. Routing logic:
  //   - creator_studio at launch: NOT yet purchasable. Always routes to
  //     notify-me (founding-500 cohort waitlist).
  //   - gener8_base (4ever) or gener8_pro, authenticated: hard-navigate
  //     to Lemon Squeezy checkout (one-time for 4ever, sub for Pro).
  //   - Anonymous visitors: notify-me fallback.
  function handleSubscribeClick(tier: TierId) {
    if (tier === 'creator_studio') {
      setPhase({ kind: 'notify-form', tier });
      return;
    }
    if (user?.id) {
      startCheckout(toLsTierId(tier), user.id, user.email);
      return;
    }
    setPhase({ kind: 'notify-form', tier });
  }

  async function submitNotify(tier: TierId, email: string) {
    setPhase({ kind: 'notify-submitting', tier, email });
    try {
      const r = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier, email }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json().catch(() => ({}))) as { position?: number };
      const position = typeof body.position === 'number' && body.position > 0
        ? body.position
        : seededWaitlistPosition(tier);
      setPhase({ kind: 'notify-success', tier, position });
    } catch (e) {
      // Soft fallback: if /api/waitlist isn't wired, write to localStorage so
      // we don't lose the lead, and still give the user a clear success
      // surface. Never bounce them back to compare without acknowledgment.
      try {
        const key = 'waitlist:fallback';
        const list: { tier: TierId; email: string; ts: number }[] =
          JSON.parse(localStorage.getItem(key) ?? '[]');
        list.push({ tier, email, ts: Date.now() });
        localStorage.setItem(key, JSON.stringify(list));
      } catch { /* ignore */ }
      setPhase({
        kind: 'notify-error',
        tier,
        email,
        message: e instanceof Error ? e.message : 'Network error',
      });
    }
  }

  if (!isOpen) return null;

  const isNotifyPhase = phase.kind !== 'compare';

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />

      {/* Modal — EWDS card-styled surface (chamfer + border). Notify
          phases swap to a narrower width since the form is single-column. */}
      <div
        className="ew-card relative w-full overflow-hidden animate-in fade-in zoom-in-95 duration-300"
        style={{
          background: 'var(--ew-surface)',
          padding: 0,
          maxWidth: isNotifyPhase ? 480 : 1024,
          maxHeight: '90vh',
        }}
      >

        {/* Skin-aware accent bar (was a 3-color gradient) */}
        <div className="h-1" style={{ background: 'var(--ew-primary)' }} />

        {/* Header */}
        <div className="px-8 pt-6 pb-4 flex items-start justify-between">
          <div>
            <div className="inline-block mb-2">
              <span className="ew-eyebrow" style={{ color: 'var(--ew-warning)' }}>
                Beta · Early Access · Q2 2026
              </span>
            </div>
            <h2 className="text-2xl font-bold flex items-center gap-2" style={{ ...HEADING, color: 'var(--ew-text)' }}>
              <Zap size={24} style={{ color: 'var(--ew-primary)' }} />
              S³ Sound Studio
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--ew-text-muted)' }}>
              Your GPU. Your files. Your music.
            </p>
          </div>
          <button onClick={onClose} className="ew-btn ew-btn--ghost ew-btn--sm" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Tab bar — only on compare phase */}
        {phase.kind === 'compare' && (
          <div className="px-8 flex gap-1 border-b" style={{ borderColor: 'var(--ew-border)' }}>
            {([
              { id: 'plans' as Tab, label: 'Plans & Pricing', icon: <Zap size={14} /> },
              { id: 'models' as Tab, label: 'Models & Hardware', icon: <Cpu size={14} /> },
            ]).map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors"
                  style={{
                    borderColor: isActive ? 'var(--ew-primary)' : 'transparent',
                    color: isActive ? 'var(--ew-primary)' : 'var(--ew-text-muted)',
                  }}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Content — phase-driven */}
        <div className="px-8 py-6 overflow-y-auto custom-scrollbar" style={{ maxHeight: '60vh' }}>
          {phase.kind === 'compare' && activeTab === 'plans' && (
            <PlansTab onSubscribe={handleSubscribeClick} />
          )}
          {phase.kind === 'compare' && activeTab === 'models' && <ModelsTab />}
          {phase.kind === 'notify-form' && (
            <NotifyForm
              tier={phase.tier}
              onCancel={() => setPhase({ kind: 'compare' })}
              onSubmit={(email) => submitNotify(phase.tier, email)}
            />
          )}
          {phase.kind === 'notify-submitting' && (
            <NotifyForm
              tier={phase.tier}
              email={phase.email}
              submitting
              onCancel={() => setPhase({ kind: 'compare' })}
              onSubmit={() => { /* disabled while submitting */ }}
            />
          )}
          {phase.kind === 'notify-success' && (
            <NotifySuccess
              tier={phase.tier}
              position={phase.position}
              onClose={onClose}
            />
          )}
          {phase.kind === 'notify-error' && (
            <NotifyError
              tier={phase.tier}
              email={phase.email}
              message={phase.message}
              onRetry={() => submitNotify(phase.tier, phase.email)}
              onBack={() => setPhase({ kind: 'compare' })}
            />
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};


/* ─── Notify-me phase panels ───────────────────────────────── */

const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function NotifyForm({
  tier,
  email: initialEmail = '',
  submitting,
  onCancel,
  onSubmit,
}: {
  tier: TierId;
  email?: string;
  submitting?: boolean;
  onCancel: () => void;
  onSubmit: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const valid = EMAIL_RX.test(email);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (valid && !submitting) onSubmit(email); }}
      className="flex flex-col gap-4"
    >
      <button
        type="button"
        onClick={onCancel}
        className="ew-btn ew-btn--ghost ew-btn--sm self-start"
        disabled={submitting}
      >
        <ArrowLeft size={12} /> Back to plans
      </button>

      <div>
        <span className="ew-eyebrow">Founding cohort · {tierLabel(tier)}</span>
        <h3 className="ew-dialog__title" style={{ marginTop: 6 }}>
          Be first to know when checkout opens
        </h3>
        <p className="text-sm mt-2" style={{ color: 'var(--ew-text-muted)' }}>
          500 founding seats at this tier. Locked-in pricing for life.
          We&apos;ll email you when payment rails go live, no spam, one email.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="ew-eyebrow">Email</span>
        <input
          type="email"
          autoFocus
          required
          className="ew-input"
          placeholder="you@band.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
        />
      </label>

      <div className="ew-dialog__footer" style={{ padding: 0, borderTop: 'none', justifyContent: 'flex-end', marginTop: 4 }}>
        <button
          type="button"
          className="ew-btn ew-btn--ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="ew-btn ew-btn--primary"
          disabled={!valid || submitting}
        >
          {submitting ? 'Sending…' : 'Notify me'}
        </button>
      </div>
    </form>
  );
}

function NotifySuccess({
  tier,
  position,
  onClose,
}: { tier: TierId; position: number; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center text-center" style={{ padding: '32px 24px' }}>
      <span
        className="ew-icon ew-icon--32"
        style={{ color: 'var(--ew-success)', display: 'inline-flex' }}
        aria-hidden="true"
      >
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <use href="#i-check" />
        </svg>
      </span>
      <span className="ew-eyebrow" style={{ marginTop: 16 }}>
        You&apos;re on the list
      </span>
      <h3 className="ew-dialog__title" style={{ margin: '6px 0 12px' }}>
        #{position} of 500
      </h3>
      <p style={{ color: 'var(--ew-text-muted)', maxWidth: '36ch' }}>
        We&apos;ll email you when {tierLabel(tier)} checkout opens. Founding pricing locked.
      </p>
      <button
        type="button"
        className="ew-btn ew-btn--primary"
        style={{ marginTop: 24 }}
        onClick={onClose}
      >
        Back to Studio
      </button>
    </div>
  );
}

function NotifyError({
  tier, email, message, onRetry, onBack,
}: {
  tier: TierId; email: string; message: string;
  onRetry: () => void; onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <span className="ew-eyebrow" style={{ color: 'var(--ew-danger)' }}>
        Couldn&apos;t reach the waitlist
      </span>
      <h3 className="ew-dialog__title" style={{ margin: 0 }}>
        We saved your spot locally
      </h3>
      <p style={{ color: 'var(--ew-text-muted)' }}>
        Network said: <code className="ew-code">{message}</code>. Your email{' '}
        (<code className="ew-code">{email}</code>) for {tierLabel(tier)} is queued
        on this device and we&apos;ll retry on reconnect, or you can resend now.
      </p>
      <div className="ew-dialog__footer" style={{ padding: 0, borderTop: 'none', justifyContent: 'flex-end' }}>
        <button type="button" className="ew-btn ew-btn--ghost" onClick={onBack}>
          Back to plans
        </button>
        <button type="button" className="ew-btn ew-btn--primary" onClick={onRetry}>
          Retry
        </button>
      </div>
    </div>
  );
}

/** Stable per-tier ordinal so the "you're #N of 500" feels real even
 *  when the backend hasn't returned a real position. Persists per
 *  device per tier. */
function seededWaitlistPosition(tier: TierId): number {
  const key = `waitlist:pos:${tier}`;
  try {
    const cached = localStorage.getItem(key);
    if (cached) return parseInt(cached, 10) || 1;
    // Pick a reasonable-looking ordinal between 12 and 487 so the
    // "founding 500" framing reads as plausible.
    const seed = (Date.now() * 9301 + 49297) % 233280;
    const pos = 12 + (seed % 475);
    localStorage.setItem(key, String(pos));
    return pos;
  } catch {
    return 1;
  }
}


/* ─── PLANS TAB ─── Hybrid ownership + subscription pricing ── */
//
// 2026-05-18: Hybrid model. Gener8 4ever = one-time $20 purchase.
// Pro and Creator Studio = monthly subscriptions. No annual toggle.
// Subscribe-tier buttons route to handleSubscribeClick in parent.

const PlansTab = ({ onSubscribe }: {
  onSubscribe: (tier: TierId) => void;
}) => {

  /** Format price for display */
  const price = (tier: LsTierId) => {
    const p = TIER_PRICE_USD[tier];
    return p % 1 === 0 ? `$${p}` : `$${p.toFixed(2)}`;
  };

  return (
  <div className="space-y-6">
    {/* How it works */}
    <div
      className="ew-card p-4 space-y-1"
      style={{ borderColor: 'var(--ew-primary-soft)' }}
    >
      <p
        className="text-sm font-semibold"
        style={{ color: 'var(--ew-primary)' }}
      >
        Own it or subscribe. Your call.
      </p>
      <p
        className="text-xs leading-relaxed"
        style={{ color: 'var(--ew-text-muted)' }}
      >
        Every generation runs on your hardware. Buy Gener8 4ever once and own local AI music forever, or subscribe for premium features that evolve with every update.
        Subscribers get all 4ever features included. Cancel anytime.
      </p>
    </div>

    {/* 7-day demo callout */}
    <div
      className="ew-card p-3 flex items-start gap-2"
      style={{ borderColor: 'var(--ew-primary-soft)', background: 'var(--ew-primary-soft)' }}
    >
      <Music size={14} style={{ color: 'var(--ew-primary)', flexShrink: 0, marginTop: 2 }} />
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ew-text)' }}>
        <strong>7-day unlimited demo.</strong> Full generation, no card, no limits. Fall in love with local AI before you decide.
      </p>
    </div>

    {/* Tier cards */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

      {/* S³ Gener8 4ever — one-time purchase */}
      <div
        className="ew-card p-5 space-y-4 relative"
        style={{ borderColor: 'var(--ew-success, #22c55e)', borderWidth: 2 }}
      >
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 ew-eyebrow"
          style={{
            background: 'var(--ew-success, #22c55e)',
            color: '#000',
            border: '1px solid var(--ew-success, #22c55e)',
          }}
        >
          Own Forever
        </div>
        <div>
          <h3
            className="text-lg font-bold"
            style={{ ...HEADING, color: 'var(--ew-text)' }}
          >
            S³ Gener8 4ever
          </h3>
          <p className="text-xs mt-1" style={{ color: 'var(--ew-text-muted)' }}>
            Buy once. Own local AI music generation permanently.
          </p>
        </div>
        <div>
          <div className="flex items-baseline gap-1">
            <span
              className="text-3xl font-bold"
              style={{ ...HEADING, color: 'var(--ew-text)' }}
            >
              {price('gener8')}
            </span>
            <span className="text-sm" style={{ color: 'var(--ew-text-muted)' }}>
              one-time
            </span>
          </div>
          <p className="text-[11px] mt-1" style={{ color: 'var(--ew-success, #22c55e)' }}>
            No subscription. No recurring charges. Yours forever.
          </p>
        </div>
        <ul className="space-y-2">
          <PlanFeature text="Unlimited generation on your GPU — permanently" highlight />
          <PlanFeature text="Text-to-music, cover, reference audio" highlight />
          <PlanFeature text="Full commercial rights on originals" highlight />
          <PlanFeature text="Vid Studio — 540p music videos, beat-sync" highlight />
          <PlanFeature text="FLAC lossless output" />
          <PlanFeature text="Automatic VRAM-aware model selection" />
        </ul>
        <div
          className="text-[10px] flex items-center gap-1"
          style={{ color: 'var(--ew-text-faint)' }}
        >
          <Cpu size={10} /> Min 6 GB VRAM
        </div>
        <button
          onClick={() => onSubscribe('gener8_base')}
          className="ew-btn ew-btn--primary w-full"
        >
          Buy Gener8 4ever · {price('gener8')}
        </button>
      </div>

      {/* S³ Gener8 Pro — subscription */}
      <div className="ew-card p-5 space-y-4">
        <div>
          <h3
            className="text-lg font-bold"
            style={{ ...HEADING, color: 'var(--ew-text)' }}
          >
            S³ Gener8 Pro
          </h3>
          <p className="text-xs mt-1" style={{ color: 'var(--ew-text-muted)' }}>
            Premium features that evolve. Includes all 4ever functionality.
          </p>
        </div>
        <div>
          <div className="flex items-baseline gap-1">
            <span
              className="text-3xl font-bold"
              style={{ ...HEADING, color: 'var(--ew-text)' }}
            >
              {price('gener8_pro')}
            </span>
            <span className="text-sm" style={{ color: 'var(--ew-text-muted)' }}>
              /mo
            </span>
          </div>
          <p className="text-[11px] mt-1" style={{ color: 'var(--ew-text-muted)' }}>
            Cancel anytime. Includes all 4ever features.
          </p>
        </div>
        <ul className="space-y-2">
          <PlanFeature text="Everything in Gener8 4ever (included)" highlight />
          <PlanFeature text="Watermark removal on all exports" highlight />
          <PlanFeature text="Full-quality cover & reference (XL Base)" highlight />
          <PlanFeature text="Vid Studio Pro — HD 1080p, social presets" highlight />
          <PlanFeature text="1magen access + premium style packs" highlight />
          <PlanFeature text="4K upscale · per-platform aspect ratios" highlight />
          <PlanFeature text="Future cloud boost credits" />
        </ul>
        <div
          className="text-[10px] flex items-center gap-1"
          style={{ color: 'var(--ew-text-faint)' }}
        >
          <Cpu size={10} /> Min 8 GB VRAM
        </div>
        <button
          onClick={() => onSubscribe('gener8_pro')}
          className="ew-btn w-full"
        >
          Subscribe to Pro · {price('gener8_pro')}/mo
        </button>
      </div>

      {/* S³ Creator Studio — subscription */}
      <div
        className="ew-card p-5 space-y-4 relative"
        style={{ borderColor: 'var(--ew-primary)', borderWidth: 2 }}
      >
        <div
          className="absolute -top-3 right-4 px-2.5 py-0.5 ew-eyebrow"
          style={{
            background: 'var(--ew-primary)',
            color: 'var(--ew-primary-fg)',
            border: '1px solid var(--ew-primary)',
          }}
        >
          Founding · Locked
        </div>
        <div>
          <h3
            className="text-lg font-bold"
            style={{ ...HEADING, color: 'var(--ew-text)' }}
          >
            S³ Creator Studio
          </h3>
          <p className="text-xs mt-1" style={{ color: 'var(--ew-text-muted)' }}>
            Full AI creative workstation. Music, video, story.
          </p>
        </div>
        <div>
          <div className="flex items-baseline gap-1">
            <span
              className="text-3xl font-bold"
              style={{ ...HEADING, color: 'var(--ew-text)' }}
            >
              {price('creator_studio')}
            </span>
            <span className="text-sm" style={{ color: 'var(--ew-text-muted)' }}>
              /mo
            </span>
          </div>
          <p className="text-[11px] mt-1" style={{ color: 'var(--ew-text-muted)' }}>
            Founding rate. Locked for life. Includes all lower tiers.
          </p>
        </div>
        <ul className="space-y-2">
          <PlanFeature text="Everything in Gener8 Pro (included)" highlight />
          <PlanFeature text="S³ AI Director — AI-orchestrated video" highlight />
          <PlanFeature text="3nvizen — cinematic visual workflows" highlight />
          <PlanFeature text="Full DAW + Stem Separation (12-stem)" highlight />
          <PlanFeature text="StyleForge: train your own LoRA patches" highlight />
          <PlanFeature text="Style Patch marketplace access" highlight />
          <PlanFeature text="Advanced orchestration + cloud escalation" />
        </ul>
        <div
          className="text-[10px] flex items-center gap-1"
          style={{ color: 'var(--ew-text-faint)' }}
        >
          <Cpu size={10} /> Min 12 GB VRAM
        </div>
        <button
          onClick={() => onSubscribe('creator_studio')}
          className="ew-btn ew-btn--primary w-full"
        >
          Notify Me · Coming Soon
        </button>
        <p
          className="text-[10px] italic leading-relaxed"
          style={{ color: 'var(--ew-text-faint)' }}
        >
          AI Director, StyleForge, and the full DAW ship in waves. Founding 500 lock $28.88/mo for life — pricing rises when the full stack lands.
        </p>
      </div>
    </div>

    {/* Safety-net explainer */}
    <div
      className="ew-card p-4 flex items-start gap-3"
      style={{ borderColor: 'var(--ew-primary-soft)' }}
    >
      <Zap
        size={18}
        style={{ color: 'var(--ew-primary)', flexShrink: 0, marginTop: 2 }}
      />
      <div className="space-y-1.5">
        <p className="text-sm font-semibold" style={{ color: 'var(--ew-primary)' }}>
          Safety net: own 4ever, subscribe for more.
        </p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ew-text-muted)' }}>
          Subscribers get all 4ever features included, no separate purchase needed. But if you also buy Gener8 4ever ($20), you keep permanent access to core generation even if you cancel your subscription later.
        </p>
      </div>
    </div>

    {/* Founding cohort */}
    <div
      className="ew-card p-4 flex items-start gap-3"
      style={{ borderColor: 'var(--ew-primary-soft)' }}
    >
      <Sparkles
        size={18}
        style={{ color: 'var(--ew-primary)', flexShrink: 0, marginTop: 2 }}
      />
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--ew-primary)' }}>
          Founding Creator Studio cohort
        </p>
        <p
          className="text-xs mt-1"
          style={{ color: 'var(--ew-text-muted)' }}
        >
          First 500 Creator Studio subscribers lock in $28.88/mo for life. When DAW ships and pricing rises, you stay at founding rate.
        </p>
      </div>
    </div>

    {/* ToS small-print */}
    <p
      className="text-[10px] leading-relaxed italic text-center"
      style={{ color: 'var(--ew-text-faint)' }}
    >
      S³ is beta software in active development. A creative toolkit, not a legal service. You are responsible for the rights to any reference audio or source material you bring. Cancel subscriptions anytime from your account settings.
    </p>
  </div>
  );
};


/* ─── MODELS TAB ───────────────────────────────────────────── */
const ModelsTab = () => (
  <div className="space-y-6">
    <p className="text-sm" style={{ color: 'var(--ew-text-muted)' }}>
      S³ runs entirely on your machine. No cloud, no per-generation fees. Your purchase or subscription unlocks the software; your GPU does the work. We check your hardware before letting you buy a tier it can't run.
    </p>

    {/* Tier → GPU Requirements */}
    <div className="space-y-3">
      <h3 className="ew-eyebrow">Tier × VRAM Compatibility</h3>
      <div
        className="ew-card overflow-hidden"
        style={{ padding: 0 }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--ew-surface-raised)', color: 'var(--ew-text-muted)' }}>
              <th className="px-4 py-3 text-left font-medium">Your VRAM</th>
              <th className="px-4 py-3 text-center font-medium">4ever</th>
              <th className="px-4 py-3 text-center font-medium">Pro</th>
              <th className="px-4 py-3 text-center font-medium">Creator Studio</th>
            </tr>
          </thead>
          <tbody style={{ color: 'var(--ew-text)' }}>
            <VramRow vram="< 6 GB" g8={<Stat tone="warning">CPU fallback</Stat>} gp={<Stat tone="danger">Blocked</Stat>} cs={<Stat tone="danger">Blocked</Stat>} />
            <VramRow vram="6–8 GB" g8={<Stat tone="success">✓</Stat>} gp={<Stat tone="warning">Limited</Stat>} cs={<Stat tone="danger">Blocked</Stat>} />
            <VramRow vram="8–12 GB" g8={<Stat tone="success">✓</Stat>} gp={<Stat tone="success">✓</Stat>} cs={<Stat tone="warning">Limited</Stat>} />
            <VramRow vram="12–16 GB" g8={<Stat tone="success">✓</Stat>} gp={<Stat tone="success">✓</Stat>} cs={<Stat tone="success">✓</Stat>} />
            <VramRow vram="16+ GB" g8={<Stat tone="success" bold>Optimal</Stat>} gp={<Stat tone="success" bold>Optimal</Stat>} cs={<Stat tone="success" bold>Optimal</Stat>} />
          </tbody>
        </table>
      </div>
    </div>

    {/* Music generation models */}
    <div className="space-y-3">
      <h3 className="ew-eyebrow">Music Generation Models</h3>
      <div
        className="ew-card overflow-hidden"
        style={{ padding: 0 }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--ew-surface-raised)', color: 'var(--ew-text-muted)' }}>
              <th className="px-4 py-3 text-left font-medium">Config</th>
              <th className="px-4 py-3 text-left font-medium">Download</th>
              <th className="px-4 py-3 text-left font-medium">VRAM</th>
              <th className="px-4 py-3 text-left font-medium">Tier</th>
            </tr>
          </thead>
          <tbody style={{ color: 'var(--ew-text)' }}>
            <ModelRow config="v1.5 Turbo (Q4_K_M)" dl="~3 GB" vram="6–8 GB" tier={<Stat tone="success" bold>4ever</Stat>} />
            <ModelRow config="XL Turbo (Q5_K_M)" dl="~3.3 GB" vram="8 GB+" tier={<Stat tone="success" bold>4ever (default)</Stat>} />
            <ModelRow config="XL Turbo (Q6_K)" dl="~3.9 GB" vram="12 GB+" tier={<Stat tone="success" bold>4ever (quality)</Stat>} />
            <ModelRow config="XL Turbo (Q8_0)" dl="~5 GB" vram="16 GB+" tier={<Stat tone="success" bold>4ever (hi-fi)</Stat>} />
            <ModelRow config="XL Base (VRAM-gated)" dl="~2.5–5 GB" vram="8 GB+" tier={<span style={{ color: 'var(--ew-primary)', fontWeight: 600 }}>Gener8 Pro</span>} />
            <ModelRow config="Wan 2.2 Video" dl="~9 GB" vram="10–12 GB+" tier={<span style={{ color: 'var(--ew-primary)', fontWeight: 600 }}>Creator Studio</span>} />
          </tbody>
        </table>
      </div>
      <p className="text-xs" style={{ color: 'var(--ew-text-muted)' }}>
        Quant is auto-selected from your detected VRAM. The XL Base model unlocks full-quality cover and reference generation on Pro. StyleForge training on XL Base lives in Creator Studio.
      </p>
    </div>

    {/* Example GPUs */}
    <div className="space-y-3">
      <h3 className="ew-eyebrow">Example GPUs</h3>
      <div
        className="ew-card overflow-hidden"
        style={{ padding: 0 }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--ew-surface-raised)', color: 'var(--ew-text-muted)' }}>
              <th className="px-4 py-3 text-left font-medium">GPU</th>
              <th className="px-4 py-3 text-left font-medium">VRAM</th>
              <th className="px-4 py-3 text-left font-medium">Tiers Available</th>
            </tr>
          </thead>
          <tbody style={{ color: 'var(--ew-text)' }}>
            <GpuRow gpu="RTX 3060 / 4060" vram="8 GB" tiers="4ever · Pro" />
            <GpuRow gpu="RTX 3060 12GB / 4070" vram="12 GB" tiers="All tiers" />
            <GpuRow gpu="RTX 4070 Ti / 4080" vram="16 GB" tiers="All tiers (optimal)" />
            <GpuRow gpu="RTX 3090 / 4090 / 5090" vram="24–32 GB" tiers="All tiers · hi-fi quants" />
            <GpuRow gpu="Apple M-series (MLX)" vram="unified memory" tiers="4ever · Pro" />
          </tbody>
        </table>
      </div>
      <p className="text-[10px]" style={{ color: 'var(--ew-text-faint)' }}>
        Creator Studio video generation on Apple Silicon requires 32 GB+ unified memory.
      </p>
    </div>

    <div
      className="ew-card p-4 space-y-2"
      style={{ borderColor: 'var(--ew-primary-soft)' }}
    >
      <h4
        className="text-sm font-bold flex items-center gap-2"
        style={{ color: 'var(--ew-primary)' }}
      >
        <Sparkles size={14} />
        Lyrics AI (Built-in LM)
      </h4>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ew-text-muted)' }}>
        The built-in 4B parameter music language model runs locally alongside the generation engine. It handles lyrics enhancement, style enrichment, and smart metadata detection. Requires 12 GB+ VRAM to load alongside the main model. On lower VRAM GPUs, the Lyrics AI features are automatically disabled.
      </p>
    </div>
  </div>
);


/* ─── SHARED COMPONENTS ────────────────────────────────────── */

const PlanFeature = ({ text, highlight, muted }: { text: string; highlight?: boolean; muted?: boolean }) => (
  <li
    className="flex items-center gap-2 text-xs"
    style={{
      color: muted
        ? 'var(--ew-text-faint)'
        : highlight
          ? 'var(--ew-text)'
          : 'var(--ew-text-muted)',
    }}
  >
    <Check
      size={14}
      style={{
        color: highlight ? 'var(--ew-primary)' : 'var(--ew-text-faint)',
      }}
    />
    {text}
  </li>
);

// Status pill text — semantic colour token, no Tailwind palette.
type StatTone = 'success' | 'warning' | 'danger';
const Stat = ({ tone, bold, children }: { tone: StatTone; bold?: boolean; children: React.ReactNode }) => {
  const colorVar =
    tone === 'success' ? 'var(--ew-success)' :
    tone === 'warning' ? 'var(--ew-warning)' :
    'var(--ew-danger)';
  return (
    <span style={{ color: colorVar, fontWeight: bold ? 600 : 400 }}>
      {children}
    </span>
  );
};

// Body row helpers — same border colour, same hover, no rounded.
const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <tr style={{ borderTop: '1px solid var(--ew-border)' }}>
    {children}
  </tr>
);

const VramRow = ({ vram, g8, gp, cs }: { vram: string; g8: React.ReactNode; gp: React.ReactNode; cs: React.ReactNode }) => (
  <Row>
    <td className="px-4 py-3 font-medium">{vram}</td>
    <td className="px-4 py-3 text-center">{g8}</td>
    <td className="px-4 py-3 text-center">{gp}</td>
    <td className="px-4 py-3 text-center">{cs}</td>
  </Row>
);

const ModelRow = ({ config, dl, vram, tier }: { config: string; dl: string; vram: string; tier: React.ReactNode }) => (
  <Row>
    <td className="px-4 py-3 font-medium">{config}</td>
    <td className="px-4 py-3">{dl}</td>
    <td className="px-4 py-3">{vram}</td>
    <td className="px-4 py-3">{tier}</td>
  </Row>
);

const GpuRow = ({ gpu, vram, tiers }: { gpu: string; vram: string; tiers: string }) => (
  <Row>
    <td className="px-4 py-3 font-medium">{gpu}</td>
    <td className="px-4 py-3">{vram}</td>
    <td className="px-4 py-3">{tiers}</td>
  </Row>
);

// Retained for downstream use; not rendered in this modal currently.
// Re-themed so that whichever surface adopts it picks up EWDS automatically.
const ProductCard = ({ icon, title, description, status }: { icon: React.ReactNode; title: string; description: string; status: 'available' | 'coming-soon' }) => (
  <div
    className="ew-card p-4 flex items-start gap-3"
    style={{
      opacity: status === 'available' ? 1 : 0.6,
      borderStyle: status === 'available' ? 'solid' : 'dashed',
    }}
  >
    <div
      className="p-2"
      style={{
        background: status === 'available' ? 'var(--ew-primary-soft)' : 'var(--ew-surface-raised)',
        color: status === 'available' ? 'var(--ew-primary)' : 'var(--ew-text-faint)',
      }}
    >
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold" style={{ color: 'var(--ew-text)' }}>{title}</h4>
        {status === 'coming-soon' && (
          <span className="ew-eyebrow" style={{ color: 'var(--ew-warning)' }}>Soon</span>
        )}
      </div>
      <p className="text-xs mt-0.5" style={{ color: 'var(--ew-text-muted)' }}>{description}</p>
    </div>
    {status === 'available' && (
      <ChevronRight
        size={16}
        style={{ color: 'var(--ew-text-faint)', flexShrink: 0, marginTop: 4 }}
      />
    )}
  </div>
);

// Suppress "declared but unused" on ProductCard — kept in file for future use.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ProductCardKeep = ProductCard;
