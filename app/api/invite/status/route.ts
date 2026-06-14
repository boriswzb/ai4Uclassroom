import { apiSuccess } from '@/lib/server/api-response';
import { isInviteSystemEnabled, isInviteUsersEnabled, checkInviteCookie } from '@/lib/server/invite-codes';

export async function GET() {
  const systemEnabled = isInviteSystemEnabled();
  const usersEnabled = isInviteUsersEnabled();
  const enabled = systemEnabled || usersEnabled;

  let invited = false;
  let username = '';

  if (enabled) {
    const result = await checkInviteCookie();
    invited = result.invited;
    username = result.username;
  }

  return apiSuccess({ enabled, invited, username });
}
