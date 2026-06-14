import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  verifyInviteCode,
  verifyInviteUser,
  findInviteUser,
  getAllInviteCodeEntries,
  DEFAULT_INVITE_USER_API_KEY,
  DEFAULT_INVITE_USER_BASE_URL,
} from '@/lib/server/invite-codes';
import { createLogger } from '@/lib/logger';

const log = createLogger('InviteVerify');

/**
 * Create an HMAC-signed token.
 * For per-user entries with credentials, embeds apiKey/baseUrl in payload.
 * Token formats (using | to avoid delimiter collision with dots in apiKeys/baseUrls):
 *   - Per-user: timestamp|username|apiKey|baseUrl|signature
 *   - Legacy:   timestamp.username.signature
 */
function createInviteToken(
  inviteCode: string,
  username: string,
  apiKey?: string,
  baseUrl?: string,
): string {
  const timestamp = Date.now().toString();
  if (apiKey && baseUrl) {
    // Per-user: pipe separator to avoid collision with dots in apiKeys
    const payload = `${timestamp}|${username}|${apiKey}|${baseUrl}`;
    const signature = createHmac('sha256', inviteCode).update(payload).digest('hex');
    return `${payload}|${signature}`;
  }
  // Legacy: dot separator
  const payload = `${timestamp}.${username}`;
  const signature = createHmac('sha256', inviteCode).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function verifyInviteTokenPayload(token: string): {
  valid: boolean;
  username?: string;
  apiKey?: string;
  baseUrl?: string;
} {
  // Try pipe-separated per-user token first (5 parts)
  const pipeParts = token.split('|');
  if (pipeParts.length === 5) {
    const [timestamp, username, apiKey, baseUrl, signature] = pipeParts;
    const user = findInviteUser(username);
    if (!user) return { valid: false };
    // Security: validate apiKey/baseUrl match stored user data (no client forgery)
    if (user.apiKey !== apiKey || user.baseUrl !== baseUrl) return { valid: false };
    const payload = `${timestamp}|${username}|${apiKey}|${baseUrl}`;
    const expected = createHmac('sha256', user.code).update(payload).digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
      return { valid: true, username, apiKey, baseUrl };
    }
    return { valid: false };
  }

  // Dot-separated legacy token: 3 parts -> timestamp.username.signature
  const dotParts = token.split('.');
  if (dotParts.length !== 3) return { valid: false };

  const [timestamp, username, signature] = dotParts;
  const payload = `${timestamp}.${username}`;

  // Try per-user first
  const user = findInviteUser(username);
  if (user) {
    const expected = createHmac('sha256', user.code).update(payload).digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
      return {
        valid: true,
        username,
        apiKey: user.apiKey || DEFAULT_INVITE_USER_API_KEY,
        baseUrl: user.baseUrl || DEFAULT_INVITE_USER_BASE_URL,
      };
    }
  }

  // Try legacy code entries
  const entries = getAllInviteCodeEntries();
  for (const entry of entries) {
    const expected = createHmac('sha256', entry.code).update(payload).digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
      return { valid: true, username };
    }
  }
  return { valid: false };
}

export async function POST(request: Request) {
  let body: { code?: string; username?: string };
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }

  if (!body.code || !body.username?.trim()) {
    return apiError('INVALID_REQUEST', 400, 'Invite code and username are required');
  }

  const username = body.username.trim();
  const code = body.code.trim();

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production',
  };
  const userCookieOptions = {
    ...cookieOptions,
    httpOnly: false,
  };

  // First try per-user verification (username + code must match a user entry)
  const userEntry = verifyInviteUser(username, code);
  if (userEntry) {
    // Per-user login — embed credentials in token
    const token = createInviteToken(
      userEntry.code,
      username,
      userEntry.apiKey || DEFAULT_INVITE_USER_API_KEY,
      userEntry.baseUrl || DEFAULT_INVITE_USER_BASE_URL,
    );

    log.info(`Per-user invite login: ${username}`);
    const response = apiSuccess({ valid: true, username });
    response.cookies.set('openmaic_invite', token, cookieOptions);
    response.cookies.set('openmaic_user', username, userCookieOptions);
    return response;
  }

  // Fall back to legacy code-only verification
  const codeEntry = verifyInviteCode(code);
  if (codeEntry) {
    const token = createInviteToken(code, username);

    log.info(`Legacy invite login: ${username} with code ${code}`);
    const response = apiSuccess({ valid: true, username });
    response.cookies.set('openmaic_invite', token, cookieOptions);
    response.cookies.set('openmaic_user', username, userCookieOptions);
    return response;
  }

  return apiError('UNAUTHORIZED', 401, 'Invalid invite code or username');
}
