'use client';

import { useState, useEffect } from 'react';
import { UserCheck, LogOut, LoaderCircle } from 'lucide-react';
import { useSettingsStore } from '@/lib/store/settings';
import { motion, AnimatePresence } from 'motion/react';
import { X, Eye, EyeOff, ArrowRight } from 'lucide-react';

/**
 * Login button shown in navbar when invite system is enabled.
 * Opens an inline invite login form when clicked.
 */
export function InviteLoginButton() {
  const [showForm, setShowForm] = useState(false);
  const [inviteStatus, setInviteStatus] = useState({ enabled: false, invited: false, username: '' });
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fetchServerProviders = useSettingsStore((s) => s.fetchServerProviders);

  useEffect(() => {
    fetch('/api/invite/status')
      .then((res) => res.json())
      .then((data) => {
        setInviteStatus({
          enabled: data.enabled,
          invited: data.invited,
          username: data.username || '',
        });
      })
      .catch(() => {
        setInviteStatus({ enabled: false, invited: false, username: '' });
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !inviteCode) return;
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/invite/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: inviteCode, username: username.trim() }),
      });

      if (res.ok) {
        setInviteStatus({ enabled: true, invited: true, username: username.trim() });
        setShowForm(false);
        setUsername('');
        setInviteCode('');
        fetchServerProviders();
        window.location.reload();
      } else {
        const data = await res.json();
        setError(data.error || '登录失败');
      }
    } catch {
      setError('登录失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/invite/logout', { method: 'POST' });
      fetchServerProviders();
      window.location.reload();
    } catch {
      window.location.reload();
    }
  }

  if (loading) return null;
  if (!inviteStatus.enabled) return null;

  return (
    <>
      {inviteStatus.invited ? (
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
          title="退出登录"
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>{inviteStatus.username}</span>
          <LogOut className="w-3 h-3 opacity-70" />
        </button>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors text-xs font-medium border border-border/50"
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>受邀用户登录</span>
        </button>
      )}

      <AnimatePresence>
        {showForm && (
          <>
            {/* Backdrop - solid dimming layer */}
            <motion.div
              className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowForm(false)}
            />
            {/* Modal card - elevated above everything */}
            <motion.div
              className="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none"
              style={{ height: '100dvh' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="relative z-[202] w-full max-w-sm mx-4 pointer-events-auto"
                initial={{ opacity: 0, y: 24, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.97 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-2xl shadow-black/20">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                        <UserCheck className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">受邀用户登录</h3>
                        <p className="text-xs text-muted-foreground">输入用户名和邀请码</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowForm(false)}
                      className="p-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <form onSubmit={handleLogin} className="space-y-3">
                    <div>
                      <input
                        type="text"
                        placeholder="用户名"
                        value={username}
                        onChange={(e) => { setUsername(e.target.value); setError(''); }}
                        className="w-full rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
                        autoComplete="off"
                        disabled={submitting}
                      />
                    </div>
                    <div>
                      <div className="relative">
                        <input
                          type={showCode ? 'text' : 'password'}
                          placeholder="邀请码"
                          value={inviteCode}
                          onChange={(e) => { setInviteCode(e.target.value); setError(''); }}
                          className="w-full rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
                          autoComplete="off"
                          disabled={submitting}
                        />
                        <button
                          type="button"
                          onClick={() => setShowCode(!showCode)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
                        >
                          {showCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {error && (
                      <p className="text-xs text-destructive text-center">{error}</p>
                    )}

                    <button
                      type="submit"
                      disabled={!username.trim() || !inviteCode || submitting}
                      className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-default transition-all"
                    >
                      {submitting ? (
                        <LoaderCircle className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <ArrowRight className="w-4 h-4" />
                          登录
                        </>
                      )}
                    </button>
                  </form>
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
