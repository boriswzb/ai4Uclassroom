/**
 * Invite Codes Configuration
 *
 * Loads invite codes from YAML file.
 * Invite codes allow users to access pre-configured server model APIs.
 *
 * Two systems:
 * 1. invite-codes.yml - shared codes (anyone with code can join)
 * 2. invite-users.yml - per-user accounts with individual API credentials
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';

const log = createLogger('InviteCodes');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InviteCodeEntry {
  code: string;
  username?: string;
  note?: string;
}

interface InviteCodesConfig {
  'invite-codes': InviteCodeEntry[];
}

// Per-user invite entries with individual API credentials
export interface InviteUserEntry {
  username: string;
  code: string;
  apiKey?: string;
  baseUrl?: string;
  note?: string;
  createdAt?: string;
}

interface InviteUsersConfig {
  'invite-users': InviteUserEntry[];
}

// ---------------------------------------------------------------------------
// YAML loading
// ---------------------------------------------------------------------------

const DEFAULT_FILENAME = 'invite-codes.yml';

const _cache: { data: InviteCodeEntry[] | null } = { data: null };

function loadInviteCodes(): InviteCodeEntry[] {
  if (_cache.data) return _cache.data;

  try {
    const filePath = path.join(process.cwd(), DEFAULT_FILENAME);
    if (!fs.existsSync(filePath)) {
      _cache.data = [];
      return _cache.data;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(raw) as InviteCodesConfig | null;
    if (!parsed || !Array.isArray(parsed['invite-codes'])) {
      _cache.data = [];
      return _cache.data;
    }
    _cache.data = parsed['invite-codes'].filter((entry) => entry?.code);
    log.info(`[InviteCodes] Loaded ${_cache.data.length} invite codes from ${DEFAULT_FILENAME}`);
    return _cache.data;
  } catch (e) {
    log.warn(`[InviteCodes] Failed to load ${DEFAULT_FILENAME}:`, e);
    _cache.data = [];
    return _cache.data;
  }
}

/**
 * Verify an invite code. Returns the matching entry or null.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyInviteCode(code: string): InviteCodeEntry | null {
  const entries = loadInviteCodes();
  for (const entry of entries) {
    const a = new TextEncoder().encode(code);
    const b = new TextEncoder().encode(entry.code);
    if (a.byteLength !== b.byteLength) continue;
    // Constant-time comparison
    let mismatch = 0;
    for (let i = 0; i < a.byteLength; i++) {
      mismatch |= a[i] ^ b[i];
    }
    if (mismatch === 0) return entry;
  }
  return null;
}

/**
 * Get all invite code entries (used for token verification).
 */
export function getAllInviteCodeEntries(): InviteCodeEntry[] {
  return loadInviteCodes();
}

/**
 * Check if invite codes are configured (i.e., invite system is enabled).
 */
export function isInviteSystemEnabled(): boolean {
  return loadInviteCodes().length > 0;
}

/**
 * Verify an invite token: `timestamp.username.signature`
 * Returns { valid, username } after checking HMAC against all known invite codes.
 */
export function verifyInviteToken(token: string): { valid: boolean; username?: string } {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false };

  const [timestamp, username, signature] = parts;
  const payload = `${timestamp}.${username}`;

  const entries = loadInviteCodes();
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

/**
 * Check the invite-token cookie from the current request.
 * Returns { invited, username, apiKey, baseUrl }.
 * apiKey and baseUrl come from the per-user token payload.
 * Must be called in a server context (Route Handler / Server Component).
 */
export async function checkInviteCookie(): Promise<{
  invited: boolean;
  username: string;
  apiKey?: string;
  baseUrl?: string;
}> {
  // Always check the invite cookie even if no invite systems are configured yet —
  // this allows the cookie to be recognized after a user logs in via an invite code.
  // If no invite systems are configured and no valid cookie exists, returns not invited.
  const anyInviteConfigured = isInviteSystemEnabled() || isInviteUsersEnabled();

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('openmaic_invite')?.value;
    if (!token) return { invited: false, username: '', apiKey: undefined, baseUrl: undefined };

    const result = verifyInviteTokenPayload(token);
    return {
      invited: result.valid,
      username: result.username || '',
      apiKey: result.apiKey,
      baseUrl: result.baseUrl,
    };
  } catch {
    return { invited: false, username: '', apiKey: undefined, baseUrl: undefined };
  }
}

/**
 * Verify token payload (timestamp.username[.apiKey.baseUrl].signature).
 * Returns credentials for per-user logins.
 */
export function verifyInviteTokenPayload(token: string): {
  valid: boolean;
  username?: string;
  apiKey?: string;
  baseUrl?: string;
} {
  // Try pipe-separated per-user token first (5 parts: timestamp|username|apiKey|baseUrl|signature)
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
/**
 * Invalidate cache (useful after config changes).
 */
export function invalidateCache(): void {
  _cache.data = null;
}

// ---------------------------------------------------------------------------
// Per-user invite system (invite-users.yml)
// ---------------------------------------------------------------------------

const USERS_FILENAME = 'invite-users.yml';
const _usersCache: { data: InviteUserEntry[] | null } = { data: null };

/**
 * Default API credentials for invited users (硅基流动).
 */
export const DEFAULT_INVITE_USER_API_KEY = 'sk-enqirowlmbyieeplzdvgqowjdmgfswnzvrxnzphrgzyxdqzx';
export const DEFAULT_INVITE_USER_BASE_URL = 'https://api.siliconflow.cn/v1';

function loadInviteUsers(): InviteUserEntry[] {
  if (_usersCache.data) return _usersCache.data;

  try {
    const filePath = path.join(process.cwd(), USERS_FILENAME);
    if (!fs.existsSync(filePath)) {
      _usersCache.data = [];
      return _usersCache.data;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(raw) as InviteUsersConfig | null;
    if (!parsed || !Array.isArray(parsed['invite-users'])) {
      _usersCache.data = [];
      return _usersCache.data;
    }
    _usersCache.data = parsed['invite-users'].filter((entry) => entry?.username && entry?.code);
    log.info(`[InviteCodes] Loaded ${_usersCache.data.length} invite users from ${USERS_FILENAME}`);
    return _usersCache.data;
  } catch (e) {
    log.warn(`[InviteCodes] Failed to load ${USERS_FILENAME}:`, e);
    _usersCache.data = [];
    return _usersCache.data;
  }
}

function saveInviteUsers(users: InviteUserEntry[]): void {
  try {
    const filePath = path.join(process.cwd(), USERS_FILENAME);
    const config: InviteUsersConfig = { 'invite-users': users };
    fs.writeFileSync(filePath, yaml.dump(config), 'utf-8');
    _usersCache.data = users;
    log.info(`[InviteCodes] Saved ${users.length} invite users to ${USERS_FILENAME}`);
  } catch (e) {
    log.error(`[InviteCodes] Failed to save ${USERS_FILENAME}:`, e);
    throw e;
  }
}

/**
 * Find an invite user entry by username.
 */
export function findInviteUser(username: string): InviteUserEntry | null {
  const users = loadInviteUsers();
  return users.find((u) => u.username === username) || null;
}

/**
 * Find an invite user by username AND verify the invite code matches.
 */
export function verifyInviteUser(username: string, code: string): InviteUserEntry | null {
  const user = findInviteUser(username);
  if (!user) return null;
  // Constant-time comparison of the code
  const a = new TextEncoder().encode(code);
  const b = new TextEncoder().encode(user.code);
  if (a.byteLength !== b.byteLength) return null;
  let mismatch = 0;
  for (let i = 0; i < a.byteLength; i++) {
    mismatch |= a[i] ^ b[i];
  }
  if (mismatch === 0) return user;
  return null;
}

/**
 * List all invite users (for admin panel).
 *
 * @returns all fields including apiKey (masked display is handled in the UI).
 */
export function listInviteUsers(): InviteUserEntry[] {
  return loadInviteUsers();
}

/**
 * Add a new invite user.
 */
export function addInviteUser(entry: InviteUserEntry): { success: boolean; error?: string } {
  const users = loadInviteUsers();
  if (users.find((u) => u.username === entry.username)) {
    return { success: false, error: `用户名 "${entry.username}" 已存在` };
  }
  users.push({
    ...entry,
    apiKey: entry.apiKey || DEFAULT_INVITE_USER_API_KEY,
    baseUrl: entry.baseUrl || DEFAULT_INVITE_USER_BASE_URL,
    createdAt: new Date().toISOString(),
  });
  saveInviteUsers(users);
  return { success: true };
}

/**
 * Update an existing invite user.
 */
export function updateInviteUser(
  username: string,
  updates: Partial<Omit<InviteUserEntry, 'username' | 'createdAt'>>,
): { success: boolean; error?: string } {
  const users = loadInviteUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) {
    return { success: false, error: `用户 "${username}" 不存在` };
  }
  users[idx] = {
    ...users[idx],
    ...updates,
    // Ensure apiKey and baseUrl have defaults if not provided
    apiKey: updates.apiKey !== undefined ? updates.apiKey : (users[idx].apiKey || DEFAULT_INVITE_USER_API_KEY),
    baseUrl: updates.baseUrl !== undefined ? updates.baseUrl : (users[idx].baseUrl || DEFAULT_INVITE_USER_BASE_URL),
  };
  saveInviteUsers(users);
  return { success: true };
}

/**
 * Delete an invite user.
 */
export function deleteInviteUser(username: string): { success: boolean; error?: string } {
  const users = loadInviteUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) {
    return { success: false, error: `用户 "${username}" 不存在` };
  }
  users.splice(idx, 1);
  saveInviteUsers(users);
  return { success: true };
}

/**
 * Check if per-user invite system has any users (i.e., invite system is active for login).
 */
export function isInviteUsersEnabled(): boolean {
  return loadInviteUsers().length > 0;
}

/**
 * Invalidate users cache.
 */
export function invalidateUsersCache(): void {
  _usersCache.data = null;
}
