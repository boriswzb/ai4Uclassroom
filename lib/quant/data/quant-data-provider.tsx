/**
 * 量化交易数据初始化 Provider
 * 在 /quant 页面挂载时：
 * 1. 获取当前用户身份（受邀用户或 Guest）
 * 2. 将 userId 注入各 store，按用户隔离加载数据
 * 3. 监听用户切换/登出事件
 */

'use client';

import { useEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import { useStrategyStore, useWatchlistStore, useAccountStore } from '../store';
import {
  getQuantUser,
  getQuantUserIdQuick,
  fetchInviteStatus,
  setInviteUsernameCache,
  logoutInviteUser,
  clearInviteUsernameCache,
  type QuantUser,
} from '../db/quant-user-identity';

interface QuantDataProviderProps {
  children: React.ReactNode;
}

// ==================== Context ====================

interface QuantUserContextValue {
  quantUser: QuantUser | null;
  isInviteUser: boolean;
  username: string;
  logout: () => Promise<void>;
  reload: () => Promise<void>; // 重新加载数据（切换用户后调用）
}

const QuantUserContext = createContext<QuantUserContextValue>({
  quantUser: null,
  isInviteUser: false,
  username: '',
  logout: async () => {},
  reload: async () => {},
});

export function useQuantUser() {
  return useContext(QuantUserContext);
}

// ==================== 内部初始化组件 ====================

function QuantDataInit({ children }: QuantDataProviderProps) {
  const [ready, setReady] = useState(false);
  const [quantUser, setQuantUser] = useState<QuantUser | null>(null);
  const initRef = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);

  // 加载数据（传入 userId）
  const loadStores = useCallback(async (userId: string) => {
    currentUserIdRef.current = userId;
    await Promise.all([
      useStrategyStore.getState().loadFromDb(userId),
      useWatchlistStore.getState().loadFromDb(userId),
      useAccountStore.getState().loadFromDb(userId),
    ]);
    console.log(`[QuantDataProvider] Loaded data for user: ${userId}`);
  }, []);

  // 重载（切换用户时调用）
  const reload = useCallback(async () => {
    // 清空所有 store
    useStrategyStore.getState().clearState();
    useWatchlistStore.getState().clearState();
    useAccountStore.getState().clearState();

    // 重新获取用户身份
    const user = await getQuantUser();
    setQuantUser(user);
    await loadStores(user.id);
  }, [loadStores]);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    async function init() {
      try {
        // 1. 获取用户身份（受邀用户优先，降级到本地 Guest）
        const user = await getQuantUser();
        setQuantUser(user);

        // 2. 如果是受邀用户，缓存 username 到 localStorage
        if (user.source === 'invite' && user.username) {
          setInviteUsernameCache(user.username);
        }

        // 3. 加载当前用户的数据
        await loadStores(user.id);

        console.log(`[QuantDataProvider] User: ${user.id} (${user.source})`);
      } catch (err) {
        console.error('[QuantDataProvider] Failed to load data:', err);
      } finally {
        setReady(true);
      }
    }

    init();
  }, [loadStores]);

  // 监听 localStorage 变化（跨 tab 检测用户切换）
  useEffect(() => {
    function handleStorageChange(e: StorageEvent) {
      if (e.key === 'quant_invite_username' || e.key === 'openmaic_invite') {
        // 用户在另一个 tab 登录/登出，当前 tab 检测到变化
        if (initRef.current) {
          reload();
        }
      }
    }
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [reload]);

  // 登出函数
  const logout = useCallback(async () => {
    try {
      await logoutInviteUser();
    } catch {
      // ignore
    }
    // 清空状态并降级为 Guest
    useStrategyStore.getState().clearState();
    useWatchlistStore.getState().clearState();
    useAccountStore.getState().clearState();

    // 重新以 Guest 身份加载
    const user = await getQuantUser();
    setQuantUser(user);
    await loadStores(user.id);
  }, [loadStores]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="text-2xl mb-2">📊</div>
          <div className="text-slate-400 text-sm">正在加载您的量化数据...</div>
        </div>
      </div>
    );
  }

  return (
    <QuantUserContext.Provider
      value={{
        quantUser,
        isInviteUser: quantUser?.source === 'invite',
        username: quantUser?.username || quantUser?.id || '',
        logout,
        reload,
      }}
    >
      {children}
    </QuantUserContext.Provider>
  );
}

export { QuantDataInit as QuantDataProvider };
