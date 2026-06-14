'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, LoaderCircle, Check, X, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import Link from 'next/link';

interface InviteUser {
  username: string;
  code: string;
  baseUrl?: string;
  note?: string;
  createdAt?: string;
}

interface Defaults {
  apiKey: string;
  baseUrl: string;
}

export default function AdminInviteUsersPage() {
  const [users, setUsers] = useState<InviteUser[]>([]);
  const [defaults, setDefaults] = useState<Defaults>({ apiKey: '', baseUrl: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // New/Edit form state
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<InviteUser | null>(null);
  const [formData, setFormData] = useState({ username: '', code: '', apiKey: '', baseUrl: '', note: '' });
  const [showCode, setShowCode] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/invite-users');
      const data = await res.json();
      if (data.success) {
        setUsers(data.users || []);
        setDefaults(data.defaults || { apiKey: '', baseUrl: '' });
      }
    } catch (err) {
      toast.error('加载用户列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  function openAddForm() {
    setEditingUser(null);
    setFormData({ username: '', code: '', apiKey: defaults.apiKey, baseUrl: defaults.baseUrl, note: '' });
    setShowForm(true);
    setShowCode(false);
    setShowApiKey(false);
  }

  function openEditForm(user: InviteUser) {
    setEditingUser(user);
    setFormData({
      username: user.username,
      code: user.code,
      apiKey: '',
      baseUrl: user.baseUrl || defaults.baseUrl,
      note: user.note || '',
    });
    setShowForm(true);
    setShowCode(false);
    setShowApiKey(false);
  }

  function closeForm() {
    setShowForm(false);
    setEditingUser(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.username.trim() || !formData.code.trim()) {
      toast.error('用户名和邀请码不能为空');
      return;
    }

    setSaving(true);
    try {
      const url = editingUser ? '/api/admin/invite-users' : '/api/admin/invite-users';
      const method = editingUser ? 'PUT' : 'POST';
      const body: Record<string, string> = {
        username: formData.username.trim(),
        code: formData.code.trim(),
        baseUrl: formData.baseUrl.trim() || defaults.baseUrl,
        note: formData.note.trim(),
      };
      if (formData.apiKey.trim()) {
        body.apiKey = formData.apiKey.trim();
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.success) {
        toast.success(editingUser ? '用户已更新' : '用户已添加');
        closeForm();
        fetchUsers();
      } else {
        toast.error(data.error || '操作失败');
      }
    } catch {
      toast.error('操作失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(username: string) {
    if (!confirm(`确定要删除用户 "${username}" 吗？`)) return;
    try {
      const res = await fetch(`/api/admin/invite-users?username=${encodeURIComponent(username)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        toast.success('用户已删除');
        fetchUsers();
      } else {
        toast.error(data.error || '删除失败');
      }
    } catch {
      toast.error('删除失败');
    }
  }

  function formatDate(iso?: string) {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('zh-CN');
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-5xl flex h-14 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-base font-semibold">受邀用户管理</h1>
              <p className="text-xs text-muted-foreground">管理受邀用户和API配置</p>
            </div>
          </div>
          <Button onClick={openAddForm} size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" />
            添加用户
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 md:px-6 py-6">
        {/* Info banner */}
        <div className="mb-6 rounded-xl border border-amber-200/50 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/30 p-4">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <strong>默认API配置：</strong>
            硅基流动 API · Base URL: <code className="text-xs bg-amber-100 dark:bg-amber-900/50 px-1 rounded">{defaults.baseUrl || 'https://api.siliconflow.cn/v1'}</code>
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            新用户将自动继承默认API配置。邀请码用于用户登录验证。
          </p>
        </div>

        {/* User table */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <LoaderCircle className="w-5 h-5 animate-spin mr-2" />
            加载中...
          </div>
        ) : users.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <p className="text-sm">暂无受邀用户</p>
            <Button variant="link" onClick={openAddForm} className="mt-2 text-primary">
              添加第一个用户
            </Button>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left font-medium px-4 py-3">用户名</th>
                  <th className="text-left font-medium px-4 py-3">邀请码</th>
                  <th className="text-left font-medium px-4 py-3">Base URL</th>
                  <th className="text-left font-medium px-4 py-3">备注</th>
                  <th className="text-left font-medium px-4 py-3">创建时间</th>
                  <th className="text-right font-medium px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.username} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{user.username}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                        {user.code}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      {user.baseUrl || defaults.baseUrl || '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {user.note || '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditForm(user)}
                          className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                          title="编辑"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(user.username)}
                          className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </main>

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={closeForm} />
          <div className="relative z-10 w-full max-w-md mx-4">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">
                  {editingUser ? '编辑用户' : '添加用户'}
                </h2>
                <button onClick={closeForm} className="p-1 rounded-md text-muted-foreground hover:bg-accent transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    用户名 <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={formData.username}
                    onChange={(e) => setFormData((f) => ({ ...f, username: e.target.value }))}
                    placeholder="例如: zhangsan"
                    disabled={!!editingUser}
                    required
                  />
                  {editingUser && (
                    <p className="text-xs text-muted-foreground mt-1">用户名不可修改</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    邀请码 <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <Input
                      type={showCode ? 'text' : 'password'}
                      value={formData.code}
                      onChange={(e) => setFormData((f) => ({ ...f, code: e.target.value }))}
                      placeholder="用户登录时需要输入的验证码"
                      required
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

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    API Key
                  </label>
                  <div className="relative">
                    <Input
                      type={showApiKey ? 'text' : 'password'}
                      value={formData.apiKey}
                      onChange={(e) => setFormData((f) => ({ ...f, apiKey: e.target.value }))}
                      placeholder={defaults.apiKey ? '留空使用默认API Key' : 'sk-xxx'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    留空使用默认API Key: <code className="font-mono">{defaults.apiKey ? defaults.apiKey.slice(0, 12) + '...' : '-'}</code>
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Base URL
                  </label>
                  <Input
                    value={formData.baseUrl}
                    onChange={(e) => setFormData((f) => ({ ...f, baseUrl: e.target.value }))}
                    placeholder={defaults.baseUrl || 'https://api.siliconflow.cn/v1'}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    留空使用默认: <code className="font-mono text-xs">{defaults.baseUrl || 'https://api.siliconflow.cn/v1'}</code>
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    备注
                  </label>
                  <Input
                    value={formData.note}
                    onChange={(e) => setFormData((f) => ({ ...f, note: e.target.value }))}
                    placeholder="可选，例如: 2026春季班学员"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={closeForm} className="flex-1">
                    取消
                  </Button>
                  <Button type="submit" disabled={saving} className="flex-1 gap-1.5">
                    {saving ? (
                      <LoaderCircle className="w-4 h-4 animate-spin" />
                    ) : editingUser ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    {editingUser ? '保存' : '添加'}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
