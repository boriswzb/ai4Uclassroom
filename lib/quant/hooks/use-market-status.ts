'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useMarketStatus
 *
 * 服务器权威的 A 股市场状态 hook
 *
 * 设计要点：
 *   1. 状态来源：每 60s 调一次 /api/quant/market-status（服务器侧计算）
 *   2. 倒计时走秒：服务器返回 secondsToNext，客户端用 setInterval(1s) 递减
 *      - 这样 API 调用频率低（60s），UI 仍然丝滑
 *      - 每 60s 与服务器重新校准一次（防止客户端时钟漂移累计误差）
 *   3. 网络错误：fallback 到本地时区判断（基于 getBeijingMinutes 算法）
 *   4. 初始值：null（未加载），调用方需判断
 */
export interface MarketStatus {
  state: 'pre-open' | 'morning' | 'lunch' | 'afternoon' | 'closed' | 'weekend';
  label: string;
  secondsToNext: number;
  nextLabel: string;
  isOpen: boolean;
  isWeekday: boolean;
  isTradingDay: boolean;
  beijingNow: string;
  serverNow: number;
}

const REFRESH_INTERVAL = 60_000;  // 60s 拉一次 API
const TICK_INTERVAL = 1_000;       // 1s 走一次倒计时

// 本地 fallback（仅在 API 失败时使用）
function fallbackMarketStatus(): MarketStatus {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const beijing = new Date(utc + 8 * 60 * 60 * 1000);
  const hour = beijing.getHours();
  const minute = beijing.getMinutes();
  const second = beijing.getSeconds();
  const weekday = beijing.getDay();
  const totalMin = hour * 60 + minute;
  const totalSec = totalMin * 60 + second;
  const isWeekday = weekday >= 1 && weekday <= 5;

  const pad = (n: number) => n.toString().padStart(2, '0');
  const beijingNow = `${beijing.getFullYear()}-${pad(beijing.getMonth() + 1)}-${pad(beijing.getDate())} ${pad(hour)}:${pad(minute)}:${pad(second)}`;

  if (!isWeekday) {
    return {
      state: 'weekend', label: '○ 周末休市', secondsToNext: 0, nextLabel: '',
      isOpen: false, isWeekday: false, isTradingDay: false, beijingNow, serverNow: now.getTime(),
    };
  }
  const OPEN_AM = 9 * 60 + 30;
  const CLOSE_AM = 11 * 60 + 30;
  const OPEN_PM = 13 * 60;
  const CLOSE_PM = 15 * 60;

  if (totalSec < OPEN_AM * 60) {
    return {
      state: 'pre-open', label: '○ 盘前', secondsToNext: OPEN_AM * 60 - totalSec, nextLabel: '距早盘开盘',
      isOpen: false, isWeekday: true, isTradingDay: true, beijingNow, serverNow: now.getTime(),
    };
  }
  if (totalMin < CLOSE_AM) {
    return {
      state: 'morning', label: '● 早盘', secondsToNext: (CLOSE_AM - totalMin) * 60 - second, nextLabel: '距午休',
      isOpen: true, isWeekday: true, isTradingDay: true, beijingNow, serverNow: now.getTime(),
    };
  }
  if (totalMin < OPEN_PM) {
    return {
      state: 'lunch', label: '☕ 午休', secondsToNext: (OPEN_PM - totalMin) * 60 - second, nextLabel: '距午盘开盘',
      isOpen: false, isWeekday: true, isTradingDay: true, beijingNow, serverNow: now.getTime(),
    };
  }
  if (totalMin < CLOSE_PM) {
    return {
      state: 'afternoon', label: '● 午盘', secondsToNext: (CLOSE_PM - totalMin) * 60 - second, nextLabel: '距收盘',
      isOpen: true, isWeekday: true, isTradingDay: true, beijingNow, serverNow: now.getTime(),
    };
  }
  return {
    state: 'closed', label: '○ 已收盘', secondsToNext: 0, nextLabel: '',
    isOpen: false, isWeekday: true, isTradingDay: true, beijingNow, serverNow: now.getTime(),
  };
}

export function useMarketStatus(): { status: MarketStatus | null; isServerAuthoritative: boolean } {
  // 用 ref 保存最新 status，避免每秒 setState 触发整个组件重渲染
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [isServerAuthoritative, setIsServerAuthoritative] = useState(false);
  const statusRef = useRef<MarketStatus | null>(null);

  // 拉服务器状态
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/quant/market-status', { cache: 'no-store' });
      if (!res.ok) throw new Error('API not ok');
      const json = await res.json();
      if (json.success && json.data) {
        statusRef.current = json.data;
        setStatus(json.data);
        setIsServerAuthoritative(true);
        return;
      }
      throw new Error('Bad payload');
    } catch {
      // 网络/服务器错误 → fallback
      const fb = fallbackMarketStatus();
      statusRef.current = fb;
      setStatus(fb);
      setIsServerAuthoritative(false);
    }
  }, []);

  useEffect(() => {
    // 立即拉一次
    fetchStatus();
    // 每 60s 与服务器重新校准
    const refreshId = setInterval(fetchStatus, REFRESH_INTERVAL);
    // 每 1s 走秒（仅递减 secondsToNext，避免整秒重新渲染整对象）
    const tickId = setInterval(() => {
      const cur = statusRef.current;
      if (!cur) return;
      // 周末/已收盘 → 倒计时不动
      if (cur.state === 'weekend' || cur.state === 'closed') return;
      const newSecondsToNext = Math.max(0, cur.secondsToNext - 1);
      const next = { ...cur, secondsToNext: newSecondsToNext };
      statusRef.current = next;
      setStatus(next);
    }, TICK_INTERVAL);
    return () => {
      clearInterval(refreshId);
      clearInterval(tickId);
    };
  }, [fetchStatus]);

  return { status, isServerAuthoritative };
}
