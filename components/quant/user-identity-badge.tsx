'use client';

/**
 * 量化交易系统顶部用户身份栏
 * - 受邀用户：显示用户名 + 切换账号 + 登出按钮
 * - Guest 用户：显示"游客" + 登录按钮（点击弹出 UserModeModal）
 *
 * 设计：原 <UserSwitcher> 组件是"多用户共享设备"的快速切换器，
 * 但 99% 场景下一个终端只有一个用户，多账户切换极少用。
 * 简化为：已登录时多一个"切换账号"按钮，点了 = 登出 + 弹登录框。
 */

import { LogIn, LogOut, Repeat, User, LoaderCircle } from 'lucide-react';
import { useUserMode, openInviteModal } from '@/components/user-mode-guard';
import { useQuantUser } from '@/lib/quant/data/quant-data-provider';
import { useState } from 'react';

export function UserIdentityBadge() {
  const { mode, username } = useUserMode();
  const { quantUser, logout } = useQuantUser();
  const [loggingOut, setLoggingOut] = useState(false);
  const [switching, setSwitching] = useState(false);

  const isInviteUser = mode === 'invited' && !!username;
  const displayName = isInviteUser ? username : '游客';

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  // 切换账号 = 登出当前 + 弹邀请码登录框（输入新邀请码即可切到新用户）
  async function handleSwitchAccount() {
    if (switching) return;
    setSwitching(true);
    try {
      await logout();
      // 短暂延迟让 logout 状态写完，再弹登录框
      setTimeout(() => {
        openInviteModal();
        setSwitching(false);
      }, 200);
    } catch {
      setSwitching(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {isInviteUser ? (
        <>
          <div className="flex items-center gap-1.5 text-sm text-slate-400">
            <User className="w-4 h-4" />
            <span>{displayName}</span>
            <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-xs font-medium">
              受邀用户
            </span>
          </div>
          <button
            onClick={handleSwitchAccount}
            disabled={switching || loggingOut}
            title="切换到其他受邀账号（先登出当前账号）"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-blue-300 hover:bg-slate-700/50 transition-colors disabled:opacity-50"
          >
            {switching ? (
              <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Repeat className="w-3.5 h-3.5" />
            )}
            切换
          </button>
          <button
            onClick={handleLogout}
            disabled={loggingOut || switching}
            title="退出登录（切到游客模式）"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors disabled:opacity-50"
          >
            {loggingOut ? (
              <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LogOut className="w-3.5 h-3.5" />
            )}
            退出
          </button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 text-sm text-slate-500">
            <User className="w-4 h-4" />
            <span>游客</span>
            <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 text-xs font-medium">
              未登录
            </span>
          </div>
          <button
            onClick={openInviteModal}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
          >
            <LogIn className="w-3.5 h-3.5" />
            登录
          </button>
        </>
      )}
    </div>
  );
}
