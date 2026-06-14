import { NextRequest, NextResponse } from 'next/server';
import { listInviteUsers, addInviteUser, updateInviteUser, deleteInviteUser } from '@/lib/server/invite-codes';

const ADMIN_USERNAME = 'boris';
const ADMIN_PASSWORD = '712296';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

// Simple Basic Auth check
function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get('Authorization');
  if (!auth || !auth.startsWith('Basic ')) return false;
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
  const [user, pass] = decoded.split(':');
  return user === ADMIN_USERNAME && pass === ADMIN_PASSWORD;
}

// GET /api/admin/invite-users — list all users
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();
  const users = listInviteUsers();
  return NextResponse.json({ users });
}

// POST /api/admin/invite-users — add a new user
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();
  const body = await req.json();
  const { username, code, apiKey, baseUrl, note } = body;

  if (!username?.trim()) return badRequest('用户名不能为空');
  if (!code?.trim()) return badRequest('邀请码不能为空');

  const result = addInviteUser({
    username: username.trim(),
    code: code.trim(),
    apiKey: apiKey?.trim() || undefined,
    baseUrl: baseUrl?.trim() || undefined,
    note: note?.trim() || undefined,
  });

  if (!result.success) return badRequest(result.error!);
  return NextResponse.json({ success: true }, { status: 201 });
}

// PUT /api/admin/invite-users — update a user
export async function PUT(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();
  const body = await req.json();
  const { username, code, apiKey, baseUrl, note } = body;

  if (!username?.trim()) return badRequest('用户名不能为空');

  const updates: Record<string, string> = {};
  if (code !== undefined) updates.code = code.trim();
  if (apiKey !== undefined) updates.apiKey = apiKey.trim();
  if (baseUrl !== undefined) updates.baseUrl = baseUrl.trim();
  if (note !== undefined) updates.note = note.trim();

  const result = updateInviteUser(username.trim(), updates);
  if (!result.success) return badRequest(result.error!);
  return NextResponse.json({ success: true });
}

// DELETE /api/admin/invite-users?username=xxx
export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) return unauthorized();
  const { searchParams } = new URL(req.url);
  const username = searchParams.get('username');

  if (!username?.trim()) return badRequest('用户名不能为空');

  const result = deleteInviteUser(username.trim());
  if (!result.success) return badRequest(result.error!);
  return NextResponse.json({ success: true });
}
