'use client';

import { useState, useEffect, useCallback } from 'react';
import { UserCheck, Plus, Trash2, Edit2, Eye, EyeOff, Check, X, LoaderCircle, LogIn } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface InviteUser {
  username: string;
  code: string;
  apiKey?: string;
  baseUrl?: string;
  note?: string;
  createdAt?: string;
}

type Mode = 'list' | 'add' | 'edit';

const CRED_KEY = 'openmaic_admin_cred';

function getStoredCred(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(CRED_KEY);
}

function setStoredCred(cred: string) {
  sessionStorage.setItem(CRED_KEY, cred);
}

function clearStoredCred() {
  sessionStorage.removeItem(CRED_KEY);
}

function authHeader(cred: string) {
  return { Authorization: `Basic ${cred}` };
}

export default function InviteUsersAdminPage() {
  const [users, setUsers] = useState<InviteUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('list');
  const [showCodes, setShowCodes] = useState<Record<string, boolean>>({});

  // Auth state
  const [loggedIn, setLoggedIn] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Add/Edit form state
  const [formUsername, setFormUsername] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Check stored credentials on mount
  useEffect(() => {
    const stored = getStoredCred();
    if (stored) setLoggedIn(true);
    setCheckingAuth(false);
  }, []);

  const fetchUsers = useCallback(async (cred: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/invite-users', { headers: authHeader(cred) });
      if (res.status === 401) {
        clearStoredCred();
        setLoggedIn(false);
        return;
      }
      if (!res.ok) throw new Error('获取列表失败');
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) {
      const cred = getStoredCred();
      if (cred) fetchUsers(cred);
    }
  }, [loggedIn, fetchUsers]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginUser.trim() || !loginPass.trim()) {
      setLoginError('请输入用户名和密码');
      return;
    }
    setLoggingIn(true);
    setLoginError('');
    try {
      const cred = btoa(`${loginUser.trim()}:${loginPass.trim()}`);
      const res = await fetch('/api/admin/invite-users', { headers: authHeader(cred) });
      if (res.status === 401) {
        setLoginError('用户名或密码错误');
        return;
      }
      if (!res.ok) throw new Error('登录失败');
      const data = await res.json();
      setStoredCred(cred);
      setLoggedIn(true);
      setUsers(data.users || []);
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : '登录失败');
    } finally {
      setLoggingIn(false);
    }
  }

  function handleLogout() {
    clearStoredCred();
    setLoggedIn(false);
    setUsers([]);
  }

  async function apiFetch(method: string, body?: Record<string, string>, queryUsername?: string) {
    const cred = getStoredCred() || '';
    const url = queryUsername
      ? `/api/admin/invite-users?username=${encodeURIComponent(queryUsername)}`
      : '/api/admin/invite-users';
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(cred),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      clearStoredCred();
      setLoggedIn(false);
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || '操作失败');
    }
    return res.json();
  }

  function goAdd() {
    setFormUsername('');
    setFormCode('');
    setFormApiKey('');
    setFormBaseUrl('');
    setFormNote('');
    setFormError('');
    setMode('add');
  }

  function goEdit(user: InviteUser) {
    setFormUsername(user.username);
    setFormCode(user.code);
    setFormApiKey(user.apiKey || '');
    setFormBaseUrl(user.baseUrl || '');
    setFormNote(user.note || '');
    setFormError('');
    setMode('edit');
  }

  function goList() {
    setMode('list');
    setFormError('');
  }

  async function handleSave() {
    if (!formUsername.trim()) { setFormError('用户名不能为空'); return; }
    if (!formCode.trim()) { setFormError('邀请码不能为空'); return; }

    setSaving(true);
    setFormError('');
    try {
      const isEdit = mode === 'edit';
      const payload: Record<string, string> = {
        username: formUsername.trim(),
        code: formCode.trim(),
      };
      if (formApiKey.trim()) payload.apiKey = formApiKey.trim();
      if (formBaseUrl.trim()) payload.baseUrl = formBaseUrl.trim();
      if (formNote.trim()) payload.note = formNote.trim();
      await apiFetch(isEdit ? 'PUT' : 'POST', payload);
      const cred = getStoredCred() || '';
      await fetchUsers(cred);
      setMode('list');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(username: string) {
    if (!confirm(`确认删除用户 "${username}"？`)) return;
    try {
      await apiFetch('DELETE', undefined, username);
      const cred = getStoredCred() || '';
      await fetchUsers(cred);
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败');
    }
  }

  // ── Not logged in: show login form ──
  if (!loggedIn && !checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-sm mx-4 p-8">
          <div className="text-center mb-8">
            <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <UserCheck className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-xl font-semibold">受邀用户管理</h2>
            <p className="text-sm text-muted-foreground mt-1">请登录以继续</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <input
                type="text"
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                placeholder="用户名"
                autoComplete="username"
                className="w-full rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
              />
            </div>
            <div>
              <input
                type="password"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                placeholder="密码"
                autoComplete="current-password"
                className="w-full rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
              />
            </div>

            {loginError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-4 py-3">
                <X className="w-4 h-4 shrink-0" />
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loggingIn ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              登录
            </button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-5xl flex h-14 items-center justify-between px-4 md:px-6">
          <a href="/" className="flex items-center gap-2 font-semibold">
            <UserCheck className="w-5 h-5 text-primary" />
            <span>受邀用户管理</span>
          </a>
          <div className="flex items-center gap-3">
            <a
              href="/quant"
              className="text-xs px-2.5 py-1 rounded-md border border-border/60 hover:border-primary hover:text-primary text-muted-foreground transition-colors"
              title="返回量化系统"
            >
              📊 量化系统
            </a>
            <span className="text-sm text-muted-foreground">boris</span>
            <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium">超级管理员</span>
            <button
              onClick={handleLogout}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="退出登录"
            >
              <LogIn className="w-4 h-4 rotate-180" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 md:px-6 py-8">

        {/* ── List View ── */}
        {mode === 'list' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">受邀用户</h1>
                <p className="text-sm text-muted-foreground mt-1">管理受邀用户的登录凭证和 API 配置</p>
              </div>
              <button
                onClick={goAdd}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity shadow-sm"
              >
                <Plus className="w-4 h-4" />
                添加用户
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <LoaderCircle className="w-6 h-6 animate-spin mr-2" />
                加载中...
              </div>
            ) : error ? (
              <div className="text-center py-20 text-destructive">{error}</div>
            ) : users.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">
                <UserCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>暂无受邀用户</p>
                <button onClick={goAdd} className="mt-3 text-sm text-primary hover:underline">添加第一个用户</button>
              </div>
            ) : (
              <Card className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/30">
                      <th className="text-left font-medium text-muted-foreground px-4 py-3">用户名</th>
                      <th className="text-left font-medium text-muted-foreground px-4 py-3">邀请码</th>
                      <th className="text-left font-medium text-muted-foreground px-4 py-3">API 密钥</th>
                      <th className="text-left font-medium text-muted-foreground px-4 py-3">Base URL</th>
                      <th className="text-left font-medium text-muted-foreground px-4 py-3">备注</th>
                      <th className="text-left font-medium text-muted-foreground px-4 py-3">创建时间</th>
                      <th className="text-right font-medium text-muted-foreground px-4 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.username} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-medium">{user.username}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs">
                            {showCodes[user.username] ? user.code : '••••••••'}
                          </span>
                          <button
                            onClick={() => setShowCodes(prev => ({ ...prev, [user.username]: !prev[user.username] }))}
                            className="ml-2 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {showCodes[user.username] ? <EyeOff className="w-3.5 h-3.5 inline" /> : <Eye className="w-3.5 h-3.5 inline" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs max-w-[120px] truncate">
                          {user.apiKey
                            ? `${user.apiKey.slice(0, 4)}******${user.apiKey.slice(-4)}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[160px] truncate">
                          {user.baseUrl || '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {user.note || '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {user.createdAt ? new Date(user.createdAt).toLocaleDateString('zh-CN') : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => goEdit(user)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                              title="编辑"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(user.username)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                              title="删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}

        {/* ── Add / Edit Form ── */}
        {(mode === 'add' || mode === 'edit') && (
          <div className="max-w-xl mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={goList}
                className="p-2 rounded-lg text-muted-foreground hover:bg-accent transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              <h1 className="text-xl font-semibold tracking-tight">
                {mode === 'add' ? '添加受邀用户' : '编辑受邀用户'}
              </h1>
            </div>

            <Card className="p-6 space-y-5">
              {/* Username */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  用户名 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  disabled={mode === 'edit'}
                  placeholder="登录时使用的用户名"
                  className="w-full rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                />
                {mode === 'edit' && (
                  <p className="text-xs text-muted-foreground mt-1">用户名不可修改</p>
                )}
              </div>

              {/* Invite Code */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  邀请码 <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showCodes['__form__'] ? 'text' : 'password'}
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    placeholder="用户登录时需要输入的邀请码"
                    className="w-full rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCodes(prev => ({ ...prev, '__form__': !prev['__form__'] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  >
                    {showCodes['__form__'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  API 密钥
                </label>
                <div className="relative">
                  <input
                    type={showCodes['__apikey__'] ? 'text' : 'password'}
                    value={formApiKey}
                    onChange={(e) => setFormApiKey(e.target.value)}
                    placeholder="可选，留空则使用系统默认密钥"
                    className="w-full rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 pr-10 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 font-mono transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCodes(prev => ({ ...prev, '__apikey__': !prev['__apikey__'] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  >
                    {showCodes['__apikey__'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">受邀用户登录后自动使用此密钥调用 AI 接口</p>
              </div>

              {/* Base URL */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Base URL
                </label>
                <input
                  type="text"
                  value={formBaseUrl}
                  onChange={(e) => setFormBaseUrl(e.target.value)}
                  placeholder="可选，如 https://api.siliconflow.cn/v1"
                  className="w-full rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
                />
                <p className="text-xs text-muted-foreground mt-1">自定义 API 端点地址</p>
              </div>

              {/* Note */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  备注
                </label>
                <input
                  type="text"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  placeholder="可选，用于内部记录"
                  className="w-full rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
                />
              </div>

              {/* Error */}
              {formError && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-xl px-4 py-3">
                  <X className="w-4 h-4 shrink-0" />
                  {formError}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={goList}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl border border-border/60 text-sm font-medium hover:bg-accent transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {saving ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  保存
                </button>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
