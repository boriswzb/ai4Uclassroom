import { NextResponse } from 'next/server';
import { apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('InviteLogout');

export async function POST() {
  const response = apiSuccess({ success: true });
  response.cookies.set('openmaic_invite', '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  response.cookies.set('openmaic_user', '', {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  log.info('Invite user logged out');
  return response;
}
