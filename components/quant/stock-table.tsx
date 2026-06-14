'use client';

/**
 * 共享个股排行表格
 * 速览模式（/quant）和专业模式因子研究页（/quant/factor-analysis）共用
 * 目的：保证两个页面的字段名/顺序/样式/数据 100% 一致
 *
 * 字段统一：# / 股票 / 最新价 / 涨跌幅 / 综合 / 动量 / 资金流 / 技术面
 * （不再有 PE 列 —— IDB 未存、screener API 偶尔缺，会显示无意义数据）
 *
 * 两种 variant：
 *   - 'lite' 速览模式：复选框 + 盯盘徽章 + 综合分进度条 + 紧凑 padding
 *   - 'pro'  专业模式：复选框 + 行点击进入详情 + 综合分颜色徽章 + 标准 padding
 */

import { useState, useEffect, useMemo } from 'react';

export interface StockRow {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  compositeScore: number;
  momentumScore: number;
  moneyFlowScore: number;
  technicalScore: number;
  // 综合分在候选池里的截面百分位（0-1；用于主流表"百分位"列）
  compositePct?: number;
}

interface StockTableProps {
  rows: StockRow[];
  variant: 'lite' | 'pro';

  // ========== 速览模式专用（variant='lite'）==========
  /** 选中股票代码集合（受控） */
  selected?: Set<string>;
  /** 切换单只 */
  onToggleOne?: (code: string) => void;
  /** 切换全部 */
  onToggleAll?: (allCodes: string[]) => void;
  /** 已在自选股（盯盘）股票集合 → 显示 📡 盯盘 徽章 */
  inWatchlist?: Set<string>;
  /** 综合分是否用进度条样式（lite 用进度条，pro 用颜色徽章） */
  showScoreBar?: boolean;

  // ========== 专业模式专用（variant='pro'）==========
  /** 已选中/标记的代码集合（显示蓝色行底色） */
  marked?: Set<string>;

  // ========== 通用 ==========
  /** 综合分超过此值显示 💎 金股徽章（lite/pro 都生效） */
  topPickThreshold?: number;
  /** 近 5 日收盘价序列（用于 sparkline 迷你折线） */
  sparkline?: Record<string, number[]>;
  /** sparkline 列是否显示（默认 false） */
  showSparkline?: boolean;
  /** 行点击回调（通用；lite 仅在股票名 cell 触发，pro 整行可点） */
  onRowClick?: (row: StockRow) => void;
  /** 综合分点击回调（独立于 onRowClick；点击综合分 cell 触发，与 K 线详情共存） */
  onScoreClick?: (row: StockRow) => void;
  /** 初始排序列：'compositeScore' | 'compositePct' | 'changePercent' | 'momentumScore' | 'moneyFlowScore' | 'technicalScore' | 'price' */
  defaultSortBy?: SortKey;
  /** 初始排序方向（默认 desc） */
  defaultSortDir?: 'asc' | 'desc';
  /** 「历史命中」统计：code -> { count(过去 5 个交易日 Top N 命中次数), avgRank, lastDate }
   *  显示在股票名旁边的 🔥 徽章，给用户"推荐稳定性"信号 */
  historyHits?: Record<string, { count: number; avgRank: number; lastDate: string | null }>;
}

/** 可排序列 */
export type SortKey = 'compositeScore' | 'compositePct' | 'changePercent' | 'momentumScore' | 'moneyFlowScore' | 'technicalScore' | 'price';

// 工具：综合分颜色（lite 用 进度条 + 数字；pro 用徽章）
function scoreBarColor(score: number): string {
  if (score >= 70) return 'bg-rose-500';
  if (score >= 40) return 'bg-blue-500';
  return 'bg-slate-600';
}
function scoreBadgeClass(score: number): string {
  if (score >= 70) return 'bg-emerald-500/20 text-emerald-400';
  if (score >= 55) return 'bg-blue-500/20 text-blue-400';
  if (score >= 40) return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-slate-500/20 text-slate-400';
}
function formatScore(v: number | undefined | null): string {
  if (v === undefined || v === null || isNaN(v)) return '-';
  return v.toFixed(0);
}

// 可排序表头组件：点击切换排序方向，未排序列点击后默认降序
function SortableTh({
  className, sortKey, current, dir, onSort, children, title,
}: {
  className: string;
  sortKey: SortKey;
  current: SortKey | undefined;
  dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  children: React.ReactNode;
  title?: string;
}) {
  const isActive = current === sortKey;
  return (
    <th
      className={`${className} cursor-pointer select-none hover:text-slate-300 transition-colors ${isActive ? 'text-cyan-400' : ''}`}
      onClick={() => onSort(sortKey)}
      title={title || `点击按${typeof children === 'string' ? children : ''}排序`}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        <span className="text-[9px] w-2 inline-block">
          {isActive ? (dir === 'desc' ? '▼' : '▲') : '↕'}
        </span>
      </span>
    </th>
  );
}

export function StockTable({
  rows,
  variant,
  selected,
  onToggleOne,
  onToggleAll,
  inWatchlist,
  showScoreBar,
  onRowClick,
  onScoreClick,
  marked,
  topPickThreshold,
  sparkline,
  showSparkline,
  defaultSortBy,
  defaultSortDir = 'desc',
  historyHits,
}: StockTableProps) {
  // 全选状态（lite 用）
  const allCodes = rows.map(r => r.code);
  const isAllSelected = !!(selected && rows.length > 0 && selected.size === rows.length);
  const isSomeSelected = !!(selected && selected.size > 0 && selected.size < rows.length);

  // 排序状态：默认按 compositeScore 降序
  const [sortBy, setSortBy] = useState<SortKey | undefined>(defaultSortBy);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir);

  // 点击表头：若同列则翻转方向，否则切到该列（降序优先）
  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(key);
      setSortDir('desc');
    }
  };

  // 排序后的 rows（稳定排序）
  const sortedRows = useMemo(() => {
    if (!sortBy) return rows;
    const mult = sortDir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      // undefined 排到末尾
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * mult;
    });
  }, [rows, sortBy, sortDir]);

  if (rows.length === 0) return null;

  // ───── 公共单元格渲染器 ─────
  const renderCheckboxCell = (code: string, isLite: boolean) => {
    // lite 模式：用 selected + onToggleOne
    if (isLite && selected && onToggleOne) {
      const checked = selected.has(code);
      return (
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggleOne(code)}
          className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500 cursor-pointer"
          title={checked ? '取消选中' : '选中'}
        />
      );
    }
    // pro 模式：state 来自 marked，onToggleOne 处理交互
    const checked = !!(marked?.has(code));
    return (
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggleOne ? () => onToggleOne(code) : undefined}
        readOnly={!onToggleOne}
        className="rounded bg-slate-700 border-slate-600 cursor-pointer"
        title={checked ? '取消选中' : '选中'}
      />
    );
  };

  const renderNameCell = (row: StockRow) => {
    const watched = variant === 'lite' && inWatchlist?.has(row.code);
    const topPick = topPickThreshold && row.compositeScore >= topPickThreshold;
    // 历史命中：过去 5 个交易日 Top N 出现次数
    const hit = historyHits?.[row.code];
    const isHot = hit && hit.count >= 3; // 连续 3 天以上 → 热门
    // lite 模式：onRowClick 触发查看 K 线详情（仅在股票名 cell 点）
    // pro 模式：整行 onClick 已接管，这里只显示
    const canClickName = variant === 'lite' && onRowClick;
    const nameClickHandler = canClickName ? () => onRowClick!(row) : undefined;
    return (
      <div className="flex items-center gap-2">
        <div
          className={canClickName ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}
          onClick={nameClickHandler}
          title={canClickName ? `点击查看 ${row.name} K线详情` : undefined}
        >
          <div className={`flex items-center gap-1.5 ${variant === 'lite' ? 'text-white font-medium' : 'font-medium text-slate-200'}`}>
            <span>{row.name}</span>
            {topPick && (
              <span
                className="text-[10px] px-1 py-0 bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-900 rounded font-bold"
                title={`💎 金股：综合分 ≥ ${topPickThreshold}`}
              >
                💎
              </span>
            )}
            {isHot && (
              <span
                className="text-[10px] px-1 py-0 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded font-bold"
                title={`🔥 连续 ${hit.count}/5 个交易日出现在 Top 10（平均排名 ${hit.avgRank.toFixed(1)}）`}
              >
                🔥{hit.count}/5
              </span>
            )}
          </div>
          <div className={`text-xs text-slate-500 ${variant === 'pro' ? 'font-mono' : ''}`}>{row.code}</div>
        </div>
        {watched && (
          <span className="text-[10px] px-1.5 py-0.5 bg-cyan-900/40 text-cyan-300 border border-cyan-700/50 rounded" title="已在自选股">
            📡 盯盘
          </span>
        )}
      </div>
    );
  };

  const renderScoreCell = (row: StockRow) => {
    // 综合分 cell 可点击（独立于行点击）— 触发详情弹窗
    const scoreClickable = !!onScoreClick;
    const scoreClickHandler = scoreClickable ? (e: React.MouseEvent) => {
      e.stopPropagation();
      onScoreClick!(row);
    } : undefined;

    if (variant === 'lite' && showScoreBar) {
      return (
        <div
          className={`flex items-center justify-end gap-2 ${scoreClickable ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
          onClick={scoreClickHandler}
          title={scoreClickable ? '点击查看综合分详情 + 计算公式' : undefined}
        >
          <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${scoreBarColor(row.compositeScore)}`}
              style={{ width: `${Math.min(100, row.compositeScore)}%` }}
            />
          </div>
          <span className="text-white font-bold w-10 text-right">{formatScore(row.compositeScore)}</span>
        </div>
      );
    }
    // pro 模式（或 lite 不带进度条时）：用颜色徽章
    return (
      <span
        className={`inline-block px-2 py-0.5 rounded font-bold ${scoreBadgeClass(row.compositeScore)} ${scoreClickable ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
        onClick={scoreClickHandler}
        title={scoreClickable ? '点击查看综合分详情 + 计算公式' : undefined}
      >
        {formatScore(row.compositeScore)}
      </span>
    );
  };

  // 💎 金股徽章：综合分超过阈值时显示
  const renderTopPickBadge = (score: number) => {
    if (topPickThreshold && score >= topPickThreshold) {
      return (
        <span
          className="text-[10px] px-1.5 py-0.5 bg-gradient-to-r from-amber-500 to-yellow-400 text-slate-900 rounded font-bold shadow-sm shadow-amber-500/30"
          title={`💎 金股：综合分 ≥ ${topPickThreshold}`}
        >
          💎 金股
        </span>
      );
    }
    return null;
  };

  // 📈 5日 sparkline 迷你折线
  const renderSparkline = (code: string) => {
    const prices = sparkline?.[code];
    if (!prices || prices.length < 2) {
      return <span className="text-slate-600 text-[10px]">-</span>;
    }
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const W = 60, H = 20;
    const step = W / (prices.length - 1);
    const path = prices.map((p, i) => {
      const x = i * step;
      const y = H - ((p - min) / range) * H;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const isUp = lastPrice >= firstPrice;
    const totalPct = ((lastPrice - firstPrice) / firstPrice) * 100;
    return (
      <div className="flex items-center gap-1">
        <svg width={W} height={H} className="flex-shrink-0">
          <path
            d={path}
            fill="none"
            stroke={isUp ? '#fb7185' : '#34d399'}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className={`text-[10px] font-mono ${isUp ? 'text-rose-400' : 'text-emerald-400'}`}>
          {isUp ? '+' : ''}{totalPct.toFixed(1)}%
        </span>
      </div>
    );
  };

  // ───── 表格样式 ─────
  const tableClass = variant === 'lite' ? 'w-full text-sm' : 'w-full text-sm';
  const thBase = variant === 'lite'
    ? 'text-left px-3 py-2 font-medium'
    : 'text-left py-2.5 px-3 font-medium';
  const tdBase = variant === 'lite' ? 'px-3 py-2' : 'py-2.5 px-3';
  const trBase = variant === 'lite'
    ? 'border-b border-slate-800/50 hover:bg-slate-800/30'
    : 'border-b border-slate-800/50 hover:bg-slate-800/30';
  const trBgLite = (code: string) =>
    inWatchlist?.has(code) ? 'bg-cyan-900/10' : '';
  const trBgPro = (code: string) =>
    marked?.has(code) ? 'bg-blue-900/20' : '';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <table className={tableClass}>
        <thead>
          <tr className="text-xs text-slate-500 border-b border-slate-800">
            {/* 复选框列 */}
            <th className={variant === 'lite' ? `${thBase} w-8` : `${thBase} w-10`}>
              {onToggleAll ? (
                <input
                  type="checkbox"
                  checked={
                    variant === 'lite'
                      ? isAllSelected
                      : !!(marked && rows.length > 0 && marked.size === rows.length)
                  }
                  ref={variant === 'lite' ? (el => { if (el) el.indeterminate = isSomeSelected; }) : undefined}
                  onChange={() => {
                    const isAllChecked = variant === 'lite'
                      ? isAllSelected
                      : !!(marked && rows.length > 0 && marked.size === rows.length);
                    if (isAllChecked) onToggleAll([]);   // 全取消
                    else onToggleAll(allCodes);           // 全选
                  }}
                  className={
                    variant === 'lite'
                      ? 'w-4 h-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500 cursor-pointer'
                      : 'rounded bg-slate-700 border-slate-600 cursor-pointer'
                  }
                  title={
                    (variant === 'lite' ? isAllSelected : !!(marked && rows.length > 0 && marked.size === rows.length))
                      ? '取消全选' : '全选'
                  }
                />
              ) : null}
            </th>
            <th className={`${thBase} w-8`}>#</th>
            <th className={thBase}>股票</th>
            <SortableTh className={`${thBase} text-right`} sortKey="price" current={sortBy} dir={sortDir} onSort={handleSort}>最新价</SortableTh>
            <SortableTh className={`${thBase} text-right`} sortKey="changePercent" current={sortBy} dir={sortDir} onSort={handleSort}>涨跌幅</SortableTh>
            {showSparkline && <th className={`${thBase} text-right`}>5日</th>}
            <SortableTh className={`${thBase} text-right`} sortKey="compositeScore" current={sortBy} dir={sortDir} onSort={handleSort}>综合</SortableTh>
            <SortableTh className={`${thBase} text-right`} sortKey="compositePct" current={sortBy} dir={sortDir} onSort={handleSort} title="综合分在候选池中的截面百分位（0-1）">百分位</SortableTh>
            <SortableTh className={`${thBase} text-right`} sortKey="momentumScore" current={sortBy} dir={sortDir} onSort={handleSort}>动量</SortableTh>
            <SortableTh className={`${thBase} text-right`} sortKey="moneyFlowScore" current={sortBy} dir={sortDir} onSort={handleSort}>资金流</SortableTh>
            <SortableTh className={`${thBase} text-right`} sortKey="technicalScore" current={sortBy} dir={sortDir} onSort={handleSort}>技术面</SortableTh>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, idx) => {
            const isPro = variant === 'pro';
            const trClass = `${trBase} ${isPro ? trBgPro(row.code) : trBgLite(row.code)} ${isPro ? 'cursor-pointer' : ''}`;
            return (
              <tr
                key={row.code}
                className={trClass}
                onClick={isPro && onRowClick ? () => onRowClick(row) : undefined}
              >
                <td className={tdBase} onClick={isPro ? (e => e.stopPropagation()) : undefined}>
                  {renderCheckboxCell(row.code, variant === 'lite')}
                </td>
                <td className={`${tdBase} text-slate-500 text-xs`}>{idx + 1}</td>
                <td className={tdBase}>{renderNameCell(row)}</td>
                <td className={`${tdBase} text-right ${isPro ? 'text-slate-200 font-mono' : 'text-white'}`}>
                  {row.price.toFixed(2)}
                </td>
                <td className={`${tdBase} text-right font-semibold ${isPro ? 'font-mono' : ''} ${row.changePercent >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {row.changePercent >= 0 ? '+' : ''}{row.changePercent.toFixed(2)}%
                </td>
                {showSparkline && (
                  <td className={`${tdBase} text-right`}>{renderSparkline(row.code)}</td>
                )}
                <td className={`${tdBase} text-right`}>{renderScoreCell(row)}</td>
                {/* 综合分百分位（候选池内排名）；省略时显示 — */}
                <td className={`${tdBase} text-right ${isPro ? 'text-slate-400 font-mono' : 'text-slate-400 text-xs'}`} title={row.compositePct != null ? `在 ${Math.round((1 - row.compositePct) * 100) + 1} 名（共 ${Math.round(1 / Math.max(row.compositePct, 0.001))} 只候选池；点击综合分看明细）` : '点击综合分查看百分位'}>
                  {row.compositePct != null
                    ? <span style={{ color: row.compositePct >= 0.7 ? '#fb7185' : row.compositePct >= 0.4 ? '#fcd34d' : '#94a3b8' }}>
                        {(row.compositePct * 100).toFixed(0)}%
                      </span>
                    : <span className="text-slate-600">—</span>}
                </td>
                <td className={`${tdBase} text-right ${isPro ? 'text-slate-400 font-mono' : 'text-slate-300 text-xs'}`}>
                  {formatScore(row.momentumScore)}
                </td>
                <td className={`${tdBase} text-right ${isPro ? 'text-slate-400 font-mono' : 'text-slate-300 text-xs'}`}>
                  {formatScore(row.moneyFlowScore)}
                </td>
                <td className={`${tdBase} text-right ${isPro ? 'text-slate-400 font-mono' : 'text-slate-300 text-xs'}`}>
                  {formatScore(row.technicalScore)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 兼容旧接口的 shim：速览模式的 ScreenerRow → StockRow
// 旧字段 pe 不在新接口里，调用方需在传入前剥离
export function toStockRow(s: any): StockRow {
  return {
    code: s.code,
    name: s.name,
    price: s.price,
    changePercent: s.changePercent,
    compositeScore: s.compositeScore ?? 0,
    momentumScore: s.momentumScore ?? 0,
    moneyFlowScore: s.moneyFlowScore ?? 0,
    technicalScore: s.technicalScore ?? 0,
    compositePct: s.compositePct,
  };
}
