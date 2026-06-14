'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/lib/store/settings';
import { useUserMode } from '@/components/user-mode-guard';

/**
 * Fetches server-configured providers on mount and merges into settings store.
 * Only fetches for invited users — guests must configure their own API keys.
 * Renders nothing — purely a side-effect component.
 */
export function ServerProvidersInit() {
  const fetchServerProviders = useSettingsStore((state) => state.fetchServerProviders);
  const { mode } = useUserMode();

  useEffect(() => {
    // Only invited users get server-configured providers
    if (mode === 'invited') {
      fetchServerProviders();
    }
  }, [mode, fetchServerProviders]);

  return null;
}
