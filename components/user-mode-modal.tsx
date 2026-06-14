'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  ArrowRight,
  ShieldCheck,
  LoaderCircle,
  UserCheck,
  Eye,
  EyeOff,
  Users,
  User,
} from 'lucide-react';

type Tab = 'guest' | 'invited';

interface UserModeModalProps {
  open: boolean;
  inviteEnabled: boolean;
  onGuestEnter: () => void;
  onInviteSuccess: (username: string) => void;
}

export function UserModeModal({
  open,
  inviteEnabled,
  onGuestEnter,
  onInviteSuccess,
}: UserModeModalProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(inviteEnabled ? 'invited' : 'guest');
  const [username, setUsername] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTab(inviteEnabled ? 'invited' : 'guest');
      setError('');
      setSuccess(false);
      setUsername('');
      setInviteCode('');
    }
  }, [open, inviteEnabled]);

  useEffect(() => {
    if (tab === 'invited' && open) {
      setTimeout(() => usernameRef.current?.focus(), 100);
    }
  }, [tab, open]);

  async function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !inviteCode || loading) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/invite/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: inviteCode, username: username.trim() }),
      });

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => onInviteSuccess(username.trim()), 600);
      } else {
        const data = await res.json();
        setError(data.error || t('userMode.inviteError'));
        setInviteCode('');
        codeRef.current?.focus();
      }
    } catch {
      setError(t('userMode.inviteError'));
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = username.trim() && inviteCode;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
        >
          {/* Background */}
          <div className="absolute inset-0 bg-background">
            <div
              className="absolute inset-0 opacity-30 dark:opacity-20"
              style={{
                backgroundImage: `
                  radial-gradient(ellipse 80% 60% at 20% 40%, var(--primary) 0%, transparent 60%),
                  radial-gradient(ellipse 60% 80% at 80% 20%, oklch(0.6 0.15 280) 0%, transparent 50%),
                  radial-gradient(ellipse 50% 50% at 60% 80%, oklch(0.5 0.12 300) 0%, transparent 50%)
                `,
              }}
            />
            <div
              className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
                backgroundSize: '128px 128px',
              }}
            />
          </div>

          {/* Content card */}
          <motion.div
            className="relative z-10 w-full max-w-md mx-4"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.96 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="rounded-2xl border border-border/50 bg-card/80 p-8 shadow-xl shadow-black/5 backdrop-blur-xl dark:bg-card/60 dark:shadow-black/20">
              {/* Icon */}
              <motion.div
                className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <Users className="h-7 w-7 text-primary" strokeWidth={1.5} />
              </motion.div>

              {/* Title */}
              <motion.h1
                className="mb-1 text-center text-lg font-semibold tracking-tight text-foreground"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.4 }}
              >
                {t('userMode.title')}
              </motion.h1>

              <motion.p
                className="mb-6 text-center text-sm text-muted-foreground"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.25, duration: 0.4 }}
              >
                AI4U Classroom
              </motion.p>

              {/* Tab switcher — only show if invite is enabled */}
              {inviteEnabled && (
                <motion.div
                  className="mb-5 flex rounded-xl border border-border/50 bg-background/40 p-1"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.28, duration: 0.4 }}
                >
                  <button
                    onClick={() => { setTab('invited'); setError(''); }}
                    className={`
                      flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-all duration-200
                      ${tab === 'invited'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}
                    `}
                  >
                    <UserCheck className="h-4 w-4" />
                    {t('userMode.invitedTab')}
                  </button>
                  <button
                    onClick={() => { setTab('guest'); setError(''); }}
                    className={`
                      flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-all duration-200
                      ${tab === 'guest'
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}
                    `}
                  >
                    <User className="h-4 w-4" />
                    {t('userMode.guestTab')}
                  </button>
                </motion.div>
              )}

              {/* ── Invited User Form ── */}
              <AnimatePresence mode="wait">
                {tab === 'invited' ? (
                  <motion.form
                    key="invited"
                    onSubmit={handleInviteSubmit}
                    className="space-y-4"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.25 }}
                  >
                    {/* Username */}
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                        {t('userMode.usernameLabel')}
                      </label>
                      <input
                        ref={usernameRef}
                        type="text"
                        placeholder={t('userMode.usernamePlaceholder')}
                        value={username}
                        onChange={(e) => {
                          setUsername(e.target.value);
                          if (error) setError('');
                        }}
                        className={`
                          w-full rounded-xl border bg-background/60 px-4 py-2.5 text-sm
                          outline-none transition-all duration-200
                          placeholder:text-muted-foreground/50
                          focus:border-primary/40 focus:ring-2 focus:ring-primary/10
                          border-border/60
                        `}
                        disabled={loading || success}
                        autoComplete="off"
                      />
                    </div>

                    {/* Invite Code */}
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                        {t('userMode.inviteCodeLabel')}
                      </label>
                      <div className="relative">
                        <input
                          ref={codeRef}
                          type={showCode ? 'text' : 'password'}
                          placeholder={t('userMode.inviteCodePlaceholder')}
                          value={inviteCode}
                          onChange={(e) => {
                            setInviteCode(e.target.value);
                            if (error) setError('');
                          }}
                          className={`
                            w-full rounded-xl border bg-background/60 px-4 py-2.5 pr-10 text-sm
                            outline-none transition-all duration-200
                            placeholder:text-muted-foreground/50
                            focus:border-primary/40 focus:ring-2 focus:ring-primary/10
                            ${error ? 'border-destructive/50 focus:border-destructive/50 focus:ring-destructive/10' : 'border-border/60'}
                          `}
                          disabled={loading || success}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCode(!showCode)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                          tabIndex={-1}
                        >
                          {showCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Hint */}
                    <p className="text-xs text-muted-foreground/70 leading-relaxed">
                      {t('userMode.invitedHint')}
                    </p>

                    {/* Submit button */}
                    <button
                      type="submit"
                      disabled={!canSubmit || loading || success}
                      className={`
                        w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium
                        transition-all duration-200
                        ${canSubmit && !loading && !success
                          ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm'
                          : 'bg-muted text-muted-foreground cursor-default'}
                      `}
                    >
                      {loading ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : success ? (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        >
                          <ShieldCheck className="h-4 w-4 text-emerald-500" />
                        </motion.div>
                      ) : (
                        <>
                          <ArrowRight className="h-4 w-4" />
                          {t('userMode.invitedSubmit')}
                        </>
                      )}
                    </button>

                    {/* Error */}
                    <AnimatePresence mode="wait">
                      {error && (
                        <motion.p
                          className="text-center text-sm text-destructive"
                          initial={{ opacity: 0, y: -4, height: 0 }}
                          animate={{ opacity: 1, y: 0, height: 'auto' }}
                          exit={{ opacity: 0, y: -4, height: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          {error}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </motion.form>
                ) : (
                  /* ── Guest Mode ── */
                  <motion.div
                    key="guest"
                    className="space-y-4"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.25 }}
                  >
                    <div className="rounded-xl border border-border/50 bg-background/40 p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/40">
                          <User className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {t('userMode.guestTitle')}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                            {t('userMode.guestDesc')}
                          </p>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={onGuestEnter}
                      className="
                        w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium
                        bg-primary text-primary-foreground hover:opacity-90 shadow-sm
                        transition-all duration-200
                      "
                    >
                      <ArrowRight className="h-4 w-4" />
                      {t('userMode.guestSubmit')}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
