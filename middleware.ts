import { NextRequest, NextResponse } from 'next/server';

/** Convert string to Uint8Array */
function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** Convert ArrayBuffer to hex string */
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify an HMAC-signed token using Web Crypto API (Edge-compatible) */
async function verifyToken(token: string, accessCode: string): Promise<boolean> {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  const keyData = encode(accessCode);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const data = encode(timestamp);
  const expected = bufToHex(await crypto.subtle.sign('HMAC', key, data.buffer as ArrayBuffer));

  // Constant-length comparison (not truly constant-time in JS, but sufficient here)
  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Generate a random 16-char hex id (Edge-compatible, uses crypto.getRandomValues).
 * Used to give each guest a unique server-side userId.
 */
function generateGuestId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── 游客 ID 派发 ─────────────────────────────────────────
  // 给所有未登录的浏览器派发独立的 openmaic_guest_id cookie
  // 这样服务端可以区分不同的游客：每个游客有独立的账户/持仓/盯盘数据
  // 受邀用户已通过 invite cookie 标识，不影响
  //
  // 注意：游客不访问任何私密/危险接口时（纯行情），cookie 也是"如果不存在就发一个"
  // 这种 lazy-init 比强制派发更友好：用户首次访问才分配
  const hasInviteCookie = request.cookies.has('openmaic_invite');
  const hasGuestCookie = request.cookies.has('openmaic_guest_id');
  let guestIdCookie: string | null = null;

  if (!hasInviteCookie && !hasGuestCookie) {
    guestIdCookie = generateGuestId();
  }

  // ─── Access Code 鉴权（如果配置了）───────────────────────
  const accessCode = process.env.ACCESS_CODE;
  if (accessCode) {
    // Whitelist: access-code endpoints, invite endpoints, health check
    if (
      pathname.startsWith('/api/access-code/') ||
      pathname.startsWith('/api/invite/') ||
      pathname === '/api/health'
    ) {
      const response = NextResponse.next();
      if (guestIdCookie) {
        response.cookies.set('openmaic_guest_id', guestIdCookie, {
          path: '/',
          maxAge: 60 * 60 * 24 * 365, // 1 年
          sameSite: 'lax',
        });
      }
      return response;
    }

    // Check cookie — validate HMAC signature, not just existence
    const cookie = request.cookies.get('openmaic_access');
    if (cookie?.value && (await verifyToken(cookie.value, accessCode))) {
      const response = NextResponse.next();
      if (guestIdCookie) {
        response.cookies.set('openmaic_guest_id', guestIdCookie, {
          path: '/',
          maxAge: 60 * 60 * 24 * 365,
          sameSite: 'lax',
        });
      }
      return response;
    }

    // API requests without valid cookie → 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
        { status: 401 },
      );
    }

    // Page requests → let through, frontend shows modal
    const response = NextResponse.next();
    if (guestIdCookie) {
      response.cookies.set('openmaic_guest_id', guestIdCookie, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      });
    }
    return response;
  }

  // Access code 未配置：放行所有请求，但确保派发游客 cookie
  const response = NextResponse.next();
  if (guestIdCookie) {
    response.cookies.set('openmaic_guest_id', guestIdCookie, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/|reports/).*)'],
};