/**
 * A 股市场状态 API（服务器权威时间）
 *
 * 背景：
 *   - 量化系统里很多地方需要"当前是否在交易时段"——比如缓存策略、倒计时、
 *     自动驾驶调度。但客户端 Date 不可信：
 *       ① 用户改了手机时间
 *       ② 用户时区不是 UTC+8（出差/海外华人）
 *       ③ 设备时钟漂移
 *   - 所以这里**在服务器侧**用 Node.js 的 Date 判断，返回结果给客户端。
 *
 * 性能：
 *   - 端点 0 IO / 0 DB 调用，每次 < 1ms
 *   - 客户端每 60s 拉一次，倒计时在客户端本地 tick 走秒
 *   - 接口加 `Cache-Control: no-cache` 防 CDN 缓存错状态
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';  // 不要静态化
export const revalidate = 0;

const MARKET_OPEN_AM  = 9 * 60 + 30; // 9:30
const MARKET_CLOSE_AM = 11 * 60 + 30; // 11:30
const MARKET_OPEN_PM  = 13 * 60;       // 13:00
const MARKET_CLOSE_PM = 15 * 60;       // 15:00

/**
 * 服务器侧获取"北京时间"的小时和分钟
 * 注意：服务器进程运行在 UTC（容器默认），所以要手动 +8
 * 不要用 toLocaleString ——服务器 locale 不可控
 */
function getBeijingHM(date: Date): { hour: number; minute: number; second: number; weekday: number } {
  // UTC ms + 8h offset
  const beijingMs = date.getTime() + 8 * 60 * 60 * 1000;
  const beijing = new Date(beijingMs);
  return {
    hour: beijing.getUTCHours(),
    minute: beijing.getUTCMinutes(),
    second: beijing.getUTCSeconds(),
    weekday: beijing.getUTCDay(),  // 0=Sun, 6=Sat
  };
}

interface MarketStatus {
  state: 'pre-open' | 'morning' | 'lunch' | 'afternoon' | 'closed' | 'weekend';
  label: string;
  secondsToNext: number;  // 距下个状态切换的秒数；Infinity 表示当前态会一直持续
  nextLabel: string;
  isOpen: boolean;         // 早盘/午盘 = true，其它 false
  isWeekday: boolean;
  isTradingDay: boolean;   // 工作日 + 非节假日（节假日需额外接口，本期先做工作日判断）
  beijingNow: string;      // 形如 "2026-06-03 10:23:45"
  serverNow: number;       // Unix ms（用于客户端时间同步）
}

function computeMarketStatus(): MarketStatus {
  const now = new Date();
  const { hour, minute, second, weekday } = getBeijingHM(now);
  const totalSec = hour * 3600 + minute * 60 + second;
  const totalMin = hour * 60 + minute;
  const isWeekday = weekday >= 1 && weekday <= 5;

  // 格式化北京时间字符串（调试 + 日志用）
  const beijingDate = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const beijingNow = `${beijingDate.getUTCFullYear()}-${pad(beijingDate.getUTCMonth() + 1)}-${pad(beijingDate.getUTCDate())} ${pad(beijingDate.getUTCHours())}:${pad(beijingDate.getUTCMinutes())}:${pad(beijingDate.getUTCSeconds())}`;

  // 周末
  if (!isWeekday) {
    return {
      state: 'weekend',
      label: '○ 周末休市',
      secondsToNext: 0,
      nextLabel: '',
      isOpen: false,
      isWeekday: false,
      isTradingDay: false,
      beijingNow,
      serverNow: now.getTime(),
    };
  }

  // 工作日内
  if (totalSec < MARKET_OPEN_AM * 60) {
    return {
      state: 'pre-open',
      label: '○ 盘前',
      secondsToNext: MARKET_OPEN_AM * 60 - totalSec,
      nextLabel: '距早盘开盘',
      isOpen: false,
      isWeekday: true,
      isTradingDay: true,
      beijingNow,
      serverNow: now.getTime(),
    };
  }
  if (totalMin < MARKET_CLOSE_AM) {
    return {
      state: 'morning',
      label: '● 早盘',
      secondsToNext: (MARKET_CLOSE_AM - totalMin) * 60 - second,
      nextLabel: '距午休',
      isOpen: true,
      isWeekday: true,
      isTradingDay: true,
      beijingNow,
      serverNow: now.getTime(),
    };
  }
  if (totalMin < MARKET_OPEN_PM) {
    return {
      state: 'lunch',
      label: '☕ 午休',
      secondsToNext: (MARKET_OPEN_PM - totalMin) * 60 - second,
      nextLabel: '距午盘开盘',
      isOpen: false,
      isWeekday: true,
      isTradingDay: true,
      beijingNow,
      serverNow: now.getTime(),
    };
  }
  if (totalMin < MARKET_CLOSE_PM) {
    return {
      state: 'afternoon',
      label: '● 午盘',
      secondsToNext: (MARKET_CLOSE_PM - totalMin) * 60 - second,
      nextLabel: '距收盘',
      isOpen: true,
      isWeekday: true,
      isTradingDay: true,
      beijingNow,
      serverNow: now.getTime(),
    };
  }
  // 已收盘（工作日 >= 15:00）
  return {
    state: 'closed',
    label: '○ 已收盘',
    secondsToNext: 0,
    nextLabel: '',
    isOpen: false,
    isWeekday: true,
    isTradingDay: true,
    beijingNow,
    serverNow: now.getTime(),
  };
}

export async function GET() {
  const data = computeMarketStatus();
  return NextResponse.json(
    { success: true, data },
    {
      headers: {
        // 强制不缓存（避免 CDN / 浏览器拿到过期状态）
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    }
  );
}
