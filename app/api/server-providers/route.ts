import {
  getServerProviders,
  getServerTTSProviders,
  getServerASRProviders,
  getServerPDFProviders,
  getServerImageProviders,
  getServerVideoProviders,
  getServerWebSearchProviders,
  resolveApiKey,
  resolveBaseUrl,
} from '@/lib/server/provider-config';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  checkInviteCookie,
  isInviteSystemEnabled,
  isInviteUsersEnabled,
  DEFAULT_INVITE_USER_API_KEY,
  DEFAULT_INVITE_USER_BASE_URL,
} from '@/lib/server/invite-codes';
import { createLogger } from '@/lib/logger';

const log = createLogger('ServerProviders');

// Empty response for non-invited users
const EMPTY_PROVIDERS = {
  providers: {},
  tts: {},
  asr: {},
  pdf: {},
  image: {},
  video: {},
  webSearch: {},
};

export async function GET() {
  try {
    const inviteSystemEnabled = isInviteSystemEnabled();
    const inviteUsersEnabled = isInviteUsersEnabled();
    log.info('Invite system enabled:', inviteSystemEnabled, 'Invite users enabled:', inviteUsersEnabled);

    // Check if user has a valid invite cookie
    const inviteCheck = await checkInviteCookie();

    // If invite system is enabled, only invited users get server providers
    if (inviteSystemEnabled || inviteUsersEnabled) {
      if (!inviteCheck.invited) {
        // Guest user — return empty providers so they must configure their own API
        log.info('User is not invited, returning empty providers');
        return apiSuccess(EMPTY_PROVIDERS);
      }

      // Invited user — return providers with their per-user credentials
      log.info('User invited:', inviteCheck.username, 'with apiKey present:', !!inviteCheck.apiKey);

      // Use invite user's apiKey/baseUrl directly (from invite-users.yml)
      // Fall back to defaults only when not set
      const userApiKey = inviteCheck.apiKey || DEFAULT_INVITE_USER_API_KEY;
      const userBaseUrl = inviteCheck.baseUrl || DEFAULT_INVITE_USER_BASE_URL;

      // Build a minimal per-user provider config (siliconflow is the default)
      const providers: Record<string, { models?: string[]; baseUrl?: string; apiKey?: string }> = {
        siliconflow: {
          baseUrl: userBaseUrl,
          apiKey: userApiKey,
        },
      };

      return apiSuccess({
        providers,
        tts: getServerTTSProviders(),
        asr: getServerASRProviders(),
        pdf: getServerPDFProviders(),
        image: getServerImageProviders(),
        video: getServerVideoProviders(),
        webSearch: getServerWebSearchProviders(),
      });
    }

    // No invite system — return real server providers
    return apiSuccess({
      providers: getServerProviders(),
      tts: getServerTTSProviders(),
      asr: getServerASRProviders(),
      pdf: getServerPDFProviders(),
      image: getServerImageProviders(),
      video: getServerVideoProviders(),
      webSearch: getServerWebSearchProviders(),
    });
  } catch (error) {
    log.error('Error fetching server providers:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
