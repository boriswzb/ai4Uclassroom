'use client';

import { useEffect, useState, ReactNode, createContext, useContext } from 'react';
import { UserModeModal } from '@/components/user-mode-modal';
import { AccessCodeModal } from '@/components/access-code-modal';
import { useSettingsStore } from '@/lib/store/settings';

type UserMode = 'guest' | 'invited';

interface UserModeContextValue {
  mode: UserMode;
  username: string;
  setMode: (mode: UserMode) => void;
}

const UserModeContext = createContext<UserModeContextValue>({
  mode: 'guest',
  username: '',
  setMode: () => {},
});

export function useUserMode() {
  return useContext(UserModeContext);
}

/**
 * 外部调用：强制弹出受邀用户登录框
 * 在 /quant 页面顶部栏的"登录"按钮触发
 */
export function openInviteModal() {
  window.dispatchEvent(new CustomEvent('__open_invite_modal__'));
}

export function UserModeGuard({ children }: { children: ReactNode }) {
  const [accessCodeStatus, setAccessCodeStatus] = useState<{
    enabled: boolean;
    authenticated: boolean;
    loading: boolean;
  }>({ enabled: false, authenticated: false, loading: true });

  const [inviteStatus, setInviteStatus] = useState<{
    enabled: boolean;
    invited: boolean;
    username: string;
    loading: boolean;
  }>({ enabled: false, invited: false, username: '', loading: true });

  const [mode, setMode] = useState<UserMode>('guest');
  const [username, setUsername] = useState('');
  const fetchServerProviders = useSettingsStore((s) => s.fetchServerProviders);

  useEffect(() => {
    let cancelled = false;

    // Check access code status (legacy ACCESS_CODE env var)
    fetch('/api/access-code/status')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setAccessCodeStatus({
            enabled: data.enabled,
            authenticated: data.authenticated,
            loading: false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccessCodeStatus({ enabled: false, authenticated: false, loading: false });
        }
      });

    // Check invite status
    fetch('/api/invite/status')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setInviteStatus({
            enabled: data.enabled,
            invited: data.invited,
            username: data.username || '',
            loading: false,
          });
          // If user was previously invited, restore mode
          if (data.invited && data.username) {
            setMode('invited');
            setUsername(data.username);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInviteStatus({ enabled: false, invited: false, username: '', loading: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loading = accessCodeStatus.loading || inviteStatus.loading;

  // Case 1: Legacy ACCESS_CODE is enabled and user hasn't authenticated
  // Show the old access code modal
  if (!loading && accessCodeStatus.enabled && !accessCodeStatus.authenticated) {
    return (
      <>
        <AccessCodeModal
          open={true}
          onSuccess={() => setAccessCodeStatus((s) => ({ ...s, authenticated: true }))}
        />
        {children}
      </>
    );
  }

  // Case 2: Invite system enabled and no ACCESS_CODE, user hasn't chosen a mode yet
  // If they have a valid invite cookie, skip the modal
  const needsModeSelection =
    !loading &&
    !accessCodeStatus.enabled && // No legacy ACCESS_CODE
    inviteStatus.enabled && // Invite system is configured
    !inviteStatus.invited && // Not already authenticated as invited
    mode === 'guest'; // Haven't explicitly entered guest mode through the modal yet

  // Track whether the user has made an explicit choice
  const [hasChosenMode, setHasChosenMode] = useState(false);

  // Check if there's a guest_mode cookie to remember their choice
  useEffect(() => {
    try {
      const guestMode = localStorage.getItem('openmaic_guest_mode');
      if (guestMode === 'true' && inviteStatus.enabled && !inviteStatus.invited) {
        setHasChosenMode(true);
        setMode('guest');
      } else if (inviteStatus.invited && inviteStatus.username) {
        // User has a valid invite cookie — restore their invited state
        setHasChosenMode(true);
        setMode('invited');
      }
    } catch {
      /* ignore */
    }
  }, [inviteStatus.enabled, inviteStatus.invited, inviteStatus.username]);

  // Skip modal on /admin/* and /media/* paths
  const isExemptPath = typeof window !== 'undefined' && (
    window.location.pathname.startsWith('/admin') ||
    window.location.pathname.startsWith('/media') ||
    window.location.pathname.startsWith('/quant') ||
    window.location.pathname.startsWith('/erp')
  );

  // ── 外部强制打开邀请登录框 ─────────────────────────────
  // 监听 custom event，外部调用 openInviteModal() 时触发
  const [forceShowModal, setForceShowModal] = useState(false);
  useEffect(() => {
    function handleOpenModal() {
      setMode('guest');
      setHasChosenMode(false);
      setForceShowModal(true);
    }
    window.addEventListener('__open_invite_modal__', handleOpenModal);
    return () => window.removeEventListener('__open_invite_modal__', handleOpenModal);
  }, []);

  const showModeModal = forceShowModal || (!loading && !accessCodeStatus.enabled && inviteStatus.enabled && !hasChosenMode && !inviteStatus.invited && !isExemptPath);

  const handleGuestEnter = () => {
    setMode('guest');
    setHasChosenMode(true);
    setForceShowModal(false);
    try {
      localStorage.setItem('openmaic_guest_mode', 'true');
    } catch {
      /* ignore */
    }
  };

  const handleInviteSuccess = (name: string) => {
    setMode('invited');
    setUsername(name);
    setHasChosenMode(true);
    setForceShowModal(false);
    // Trigger server providers fetch so invited user gets server API configs
    fetchServerProviders();
  };

  // For invited users, auto-fetch server providers on mount
  useEffect(() => {
    if (inviteStatus.invited && inviteStatus.username) {
      fetchServerProviders();
    }
  }, [inviteStatus.invited, inviteStatus.username, fetchServerProviders]);

  return (
    <UserModeContext.Provider value={{ mode, username, setMode }}>
      {showModeModal && (
        <UserModeModal
          open={true}
          inviteEnabled={inviteStatus.enabled}
          onGuestEnter={handleGuestEnter}
          onInviteSuccess={handleInviteSuccess}
        />
      )}
      {children}
    </UserModeContext.Provider>
  );
}
