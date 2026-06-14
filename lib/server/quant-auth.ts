/**
 * 量化交易 API 服务端鉴权
 * 验证 openmaic_invite HTTP-only cookie，确认用户身份
 */

import { checkInviteCookie } from './invite-codes';
import { apiError } from './api-response';
import type { NextResponse } from 'next/server';

/**
 * 验证当前请求的用户身份
 * - 受邀用户：返回 { invited: true, username }
 * - Guest：返回 { invited: false }
 */
export async function verifyRequestUser(): Promise<
  { invited: true; username: string } | { invited: false }
> {
  const result = await checkInviteCookie();
  if (result.invited && result.username) {
    return { invited: true, username: result.username };
  }
  return { invited: false };
}

/**
 * 受邀用户专用的 API 响应
 * 若未登录，返回 401 并附带提示
 */
export async function requireInviteUser(): Promise<{ username: string } | NextResponse> {
  const user = await verifyRequestUser();
  if (!user.invited) {
    return apiError('UNAUTHORIZED', 401, '请先登录后再使用此功能');
  }
  return { username: user.username };
}
