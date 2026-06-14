/**
 * 服务器侧模拟交易状态查询（供浏览器端兜底用）
 *
 * 场景：
 *   - 浏览器 A 登录 boris，做了交易
 *   - 浏览器 B（清缓存/换设备）登录 boris，IndexedDB 是空的
 *   - 浏览器 B 的 restore() 先查 IndexedDB（空），再调这个 API 拉服务器数据
 *   - 拉到后写回 IndexedDB
 *
 * 安全：
 *   - 必须带 invite cookie，否则 401
 *   - 只能查自己的 userId（不能查别人的）
 */
import { NextRequest, NextResponse } from 'next/server';
import { simulatorStateStore } from '@/lib/quant/store/simulator-state-store';
import { checkInviteCookie } from '@/lib/server/invite-codes';

export async function GET(req: NextRequest) {
  const user = await checkInviteCookie();
  const userId = user.invited ? user.username : `guest_${user.username || 'anonymous'}`;

  // 防止越权：只允许查自己的（从前端 query 拿到的 userId 必须和 cookie 一致）
  const { searchParams } = new URL(req.url);
  const requestedUserId = searchParams.get('userId');
  if (requestedUserId && requestedUserId !== userId) {
    return NextResponse.json(
      { success: false, error: 'Forbidden: cannot query other user state' },
      { status: 403 }
    );
  }

  const state = await simulatorStateStore.load(userId);
  if (!state) {
    return NextResponse.json(
      { success: false, error: 'No state found for current user' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    data: state,
    userId,
  });
}

/**
 * 下载当前用户的完整状态（JSON 文件）
 * - 浏览器端 fetch → 触发文件下载
 */
export async function POST(req: NextRequest) {
  // POST /api/quant/simulator-state 触发导出
  const user = await checkInviteCookie();
  const userId = user.invited ? user.username : `guest_${user.username || 'anonymous'}`;

  const state = await simulatorStateStore.load(userId);
  if (!state) {
    return NextResponse.json(
      { success: false, error: '当前用户没有状态可导出' },
      { status: 404 }
    );
  }

  const exportPayload = {
    __format: 'quant-simulator-state-v1',
    exportedAt: Date.now(),
    userId,
    state,
  };

  // 返回 JSON 文件下载
  const filename = `quant-state-${userId}-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(exportPayload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

/**
 * 导入状态（覆盖当前用户的服务器 JSON）
 * - Body: { state: SimulatorState, mergeStrategy: 'overwrite' | 'merge' }
 * - 安全：必须带 cookie，且 userId 必须与 cookie 一致
 */
export async function PUT(req: NextRequest) {
  const user = await checkInviteCookie();
  const userId = user.invited ? user.username : `guest_${user.username || 'anonymous'}`;

  let body: { state?: any; mergeStrategy?: 'overwrite' | 'merge' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = body?.state;
  if (!incoming || incoming.userId !== userId) {
    return NextResponse.json(
      { success: false, error: 'userId mismatch / state missing' },
      { status: 400 }
    );
  }

  // 基础校验
  if (typeof incoming.account?.cash !== 'number' || !Array.isArray(incoming.positions)) {
    return NextResponse.json({ success: false, error: 'Schema invalid' }, { status: 400 });
  }

  const strategy = body.mergeStrategy || 'overwrite';
  if (strategy === 'merge') {
    // 合并：保留现有 orders/trades，追加导入的
    const existing = await simulatorStateStore.load(userId);
    if (existing) {
      // positions: 以 code 为 key，导入的覆盖
      const posMap = new Map<string, any>();
      for (const p of existing.positions) posMap.set(p.code, p);
      for (const p of incoming.positions) posMap.set(p.code, p);
      incoming.positions = Array.from(posMap.values());
      // orders: 按 id 合并去重
      const orderMap = new Map<string, any>();
      for (const o of existing.orders) orderMap.set(o.id, o);
      for (const o of incoming.orders) orderMap.set(o.id, o);
      incoming.orders = Array.from(orderMap.values()).slice(0, 100);
      // trades: 同样
      const tradeMap = new Map<string, any>();
      for (const t of existing.trades) tradeMap.set(t.id, t);
      for (const t of incoming.trades) tradeMap.set(t.id, t);
      incoming.trades = Array.from(tradeMap.values()).slice(0, 200);
    }
  }

  incoming.updatedAt = Date.now();
  await simulatorStateStore.save(incoming);

  return NextResponse.json({
    success: true,
    message: `已${strategy === 'overwrite' ? '覆盖' : '合并'}导入 ${incoming.positions.length} 个持仓`,
    data: { userId, positions: incoming.positions.length, orders: incoming.orders.length, trades: incoming.trades.length },
  });
}
