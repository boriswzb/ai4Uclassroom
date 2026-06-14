/**
 * 用户身份管理
 * 首次访问时在 IndexedDB 中生成 UUID，后续持久化
 * 可选关联 Supabase Auth 实现多设备同步
 */

import { nanoid } from 'nanoid';
import { db } from './database';
import type { DbUser } from './schema';

const LOCAL_USER_KEY = 'quant_local_user_id';

/**
 * 获取或创建本地用户
 * 优先从 IndexedDB 读取，若无则创建并存储
 */
export async function getOrCreateLocalUser(): Promise<DbUser> {
  // 先检查内存缓存
  const cached = (globalThis as any).__quant_local_user;
  if (cached) return cached;

  // 从 IndexedDB 查找
  const existing = await db.users!.toCollection().first();
  if (existing) {
    (globalThis as any).__quant_local_user = existing;
    return existing;
  }

  // 创建新用户
  const newUser: DbUser = {
    id: nanoid(),
    createdAt: Date.now(),
  };
  await db.users!.add(newUser);
  (globalThis as any).__quant_local_user = newUser;
  return newUser;
}

/**
 * 获取本地用户（同步版本，从 localStorage 快速读取）
 * 可能在 IndexedDB 真实数据返回前返回空，需异步校正
 */
export function getLocalUserIdQuick(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LOCAL_USER_KEY);
}

/**
 * 异步获取用户ID（保证一致性）
 */
export async function getLocalUserId(): Promise<string> {
  const user = await getOrCreateLocalUser();
  return user.id;
}

/**
 * 同步设置本地用户ID（用于 localStorage 快速访问）
 * 在 getOrCreateLocalUser 后调用
 */
export function syncLocalUserIdToStorage(userId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCAL_USER_KEY, userId);
}

/**
 * 更新用户资料（昵称、邮箱）
 */
export async function updateUserProfile(updates: {
  nickname?: string;
  email?: string;
}): Promise<void> {
  const user = await getOrCreateLocalUser();
  await db.users!.update(user.id, {
    ...updates,
  });
  // 清除缓存
  (globalThis as any).__quant_local_user = null;
}

/**
 * 关联 Supabase Auth 用户
 */
export async function linkSupabaseUser(supabaseUserId: string): Promise<void> {
  const user = await getOrCreateLocalUser();
  await db.users!.update(user.id, { supabaseUserId });
  (globalThis as any).__quant_local_user = null;
}

/**
 * 获取 Supabase 关联用户ID
 */
export async function getSupabaseUserId(): Promise<string | undefined> {
  const user = await getOrCreateLocalUser();
  return user.supabaseUserId;
}

/**
 * 检查是否已关联 Supabase
 */
export async function isLinkedToSupabase(): Promise<boolean> {
  const supabaseId = await getSupabaseUserId();
  return !!supabaseId;
}

/**
 * 获取用户完整信息
 */
export async function getLocalUser(): Promise<DbUser | undefined> {
  return getOrCreateLocalUser();
}
