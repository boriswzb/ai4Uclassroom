/**
 * 量化交易系统 - 用户身份管理
 * 
 * 受邀用户体系：
 * - OpenMAIC 受邀用户：userId = username（来自 invite cookie / openmaic_user cookie）
 * - Guest 用户：userId = 浏览器本地 UUID（不变）
 * 
 * 核心逻辑：
 * 1. 优先从 invite cookie 获取 username → 作为 quant userId
 * 2. 若无 invite cookie → 降级到本地 UUID（Guest 模式）
 * 3. 所有数据表按 userId 隔离
 */

import { nanoid } from 'nanoid';
import { db } from './database';
import type { DbUser } from './schema';

const LOCAL_USER_KEY = 'quant_local_user_id';
const INVITE_USER_KEY = 'quant_invite_username';

// ==================== 类型 ====================

export type QuantUserId = string; // 受邀用户为 username，Guest 为本地 UUID

export interface QuantUser {
  id: string;          // quant userId（username 或本地 UUID）
  source: 'invite' | 'local';  // 来源
  username?: string;   // 受邀用户的 username
}

// ==================== 本地用户（Guest 模式） ====================

/**
 * 获取或创建本地 Guest 用户（浏览器 UUID）
 * 优先从 IndexedDB 读取，若无则创建并存储
 */
export async function getOrCreateLocalUser(): Promise<DbUser> {
  const cached = (globalThis as any).__quant_local_user;
  if (cached) return cached;

  const existing = await db.users!.toCollection().first();
  if (existing) {
    (globalThis as any).__quant_local_user = existing;
    // 确保 localStorage 也写入（首次创建后刷新页面需要）
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_USER_KEY, existing.id);
    }
    return existing;
  }

  const newUser: DbUser = {
    id: nanoid(),
    createdAt: Date.now(),
  };
  await db.users!.add(newUser);
  (globalThis as any).__quant_local_user = newUser;
  // Guest 用户 ID 也写入 localStorage，确保刷新后 userId 不变
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LOCAL_USER_KEY, newUser.id);
  }
  return newUser;
}

/**
 * 同步获取本地用户 ID（从 localStorage 快速读取）
 */
export function getLocalUserIdQuick(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LOCAL_USER_KEY);
}

// ==================== 受邀用户（核心） ====================

/**
 * 从 /api/invite/status 获取当前用户身份
 * 读取 openmaic_user cookie（JS 可读的非 HTTP-only cookie）
 */
export async function fetchInviteStatus(): Promise<{
  invited: boolean;
  username: string;
}> {
  try {
    const res = await fetch('/api/invite/status', { credentials: 'include' });
    if (!res.ok) return { invited: false, username: '' };
    const data = await res.json();
    return {
      invited: data.invited ?? false,
      username: data.username ?? '',
    };
  } catch {
    return { invited: false, username: '' };
  }
}

/**
 * 获取受邀用户的 quant userId（username）
 * 从 localStorage 缓存读取（登录时写入）
 */
export function getInviteUsernameQuick(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(INVITE_USER_KEY);
}

/**
 * 设置受邀用户名缓存（登录成功时调用）
 */
export function setInviteUsernameCache(username: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(INVITE_USER_KEY, username);
}

/**
 * 清除受邀用户名缓存（登出时调用）
 */
export function clearInviteUsernameCache(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(INVITE_USER_KEY);
}

// ==================== 统一用户身份获取 ====================

/**
 * 获取当前 quant 用户身份
 * - 受邀用户 → { id: username, source: 'invite', username }
 * - Guest 用户 → { id: localUUID, source: 'local' }
 * 
 * 优先使用已缓存的 invite username，否则降级到本地 UUID
 */
export async function getQuantUser(): Promise<QuantUser> {
  // 1. 尝试获取受邀用户身份
  const inviteStatus = await fetchInviteStatus();
  if (inviteStatus.invited && inviteStatus.username) {
    const quantUser: QuantUser = {
      id: inviteStatus.username,
      source: 'invite',
      username: inviteStatus.username,
    };
    // 缓存到 localStorage
    setInviteUsernameCache(inviteStatus.username);
    return quantUser;
  }

  // 2. 降级到本地 Guest 用户
  const localUser = await getOrCreateLocalUser();
  return {
    id: localUser.id,
    source: 'local',
  };
}

/**
 * 同步获取当前 quant userId（可能有延迟）
 * 先查 localStorage 缓存，再查 localStorage 的 UUID
 */
export function getQuantUserIdQuick(): string {
  if (typeof window === 'undefined') return '';
  // 优先用受邀用户缓存
  const inviteUsername = localStorage.getItem(INVITE_USER_KEY);
  if (inviteUsername) return inviteUsername;
  // 降级到本地 UUID
  return localStorage.getItem(LOCAL_USER_KEY) || '';
}

/**
 * 判断当前是否为受邀用户
 */
export async function isInviteUser(): Promise<boolean> {
  const status = await fetchInviteStatus();
  return status.invited && !!status.username;
}

// ==================== 用户登出 ====================

/**
 * 登出受邀用户
 * 调用 /api/invite/logout 清除 cookie，并清空本地缓存
 */
export async function logoutInviteUser(): Promise<void> {
  try {
    await fetch('/api/invite/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // ignore
  }
  clearInviteUsernameCache();
  // 清除本地用户缓存，刷新页面后自动降级为 Guest
  (globalThis as any).__quant_local_user = null;
}

// ==================== 用户资料更新 ====================

export async function updateUserProfile(updates: {
  nickname?: string;
  email?: string;
}): Promise<void> {
  const user = await getOrCreateLocalUser();
  await db.users!.update(user.id, { ...updates });
  (globalThis as any).__quant_local_user = null;
}
