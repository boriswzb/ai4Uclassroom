'use client';

/**
 * 股票详情面板（公司/新闻/异动）
 *
 * 用于嵌入到 StockChart 弹窗右侧。
 * 复用现有 API：
 *   - /api/stock/company-profile   公司简介（东方财富 F10）
 *   - /api/stock/news?code=&type=  个股新闻（带情感标签）
 *   - /api/stock/alerts            涨跌停/异动池（按 code 客户端过滤）
 *
 * 设计：
 *   - 三个 Tab 切换：🏢 公司 / 📰 新闻 / 🚨 异动
 *   - 每个 Tab 独立加载状态和错误状态
 *   - 链接外链（公司网站/新闻原文）用 target="_blank" + rel="noopener"
 *   - 异动按日期分组，按 alertType 上色
 */

import { useEffect, useState, useCallback } from 'react';

// ==================== 类型 ====================

interface CompanyProfile {
  code: string;
  name: string;
  orgName: string;
  orgProfile: string;
  mainBusiness: string;
  chairman: string;
  foundDate: string;
  listingDate: string;
  regCapitalFormatted: string;
  tradeMarket: string;
  controlHolder: string;
  areaBoard: string;
  grossProfitRatio: number;
  incomeStructure: string;
  orgTel: string;
  orgEmail: string;
  orgWeb: string;
  address: string;
}

interface NewsItem {
  id: string;
  title: string;
  content: string;
  source: string;
  publishTime: string;
  url: string;
  tags: string[];
  sentiment?: 'positive' | 'negative' | 'neutral';
  isImportant: boolean;
}

interface AlertItem {
  code: string;
  name: string;
  alertType: 'zt' | 'dt' | 'yd' | 'lhb';
  alertReason: string;
  publishTime: string;
  changePercent: number;
  turnover: number;
  amount: number;
  closePrice: number;
  preClose: number;
}

type TabKey = 'company' | 'news' | 'alerts';

interface StockDetailPanelProps {
  code: string;
  name: string;
}

// ==================== 主组件 ====================

export default function StockDetailPanel({ code, name }: StockDetailPanelProps) {
  const [tab, setTab] = useState<TabKey>('company');

  return (
    <div className="flex flex-col h-full bg-[#1a1a2e] text-gray-200">
      {/* Tab 切换栏 */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-[#2d2d3d] shrink-0">
        {([
          { key: 'company' as TabKey, label: '🏢 公司', title: '公司简介 · 主营业务 · 联系方式' },
          { key: 'news' as TabKey, label: '📰 新闻', title: '个股新闻 · 利好/利空标记' },
          { key: 'alerts' as TabKey, label: '🚨 异动', title: '近30天涨跌停/异动记录' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            title={t.title}
            className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
              tab === t.key
                ? 'bg-blue-600 text-white font-medium'
                : 'bg-[#2d2d3d] text-gray-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'company' && <CompanyPanel code={code} name={name} />}
        {tab === 'news' && <NewsPanel code={code} name={name} />}
        {tab === 'alerts' && <AlertsPanel code={code} name={name} />}
      </div>
    </div>
  );
}

// ==================== 公司信息 Tab ====================

function CompanyPanel({ code, name }: { code: string; name: string }) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stock/company-profile?codes=${encodeURIComponent(code)}`);
      const json = await res.json();
      // 响应格式: { success, count, data: [CompanyProfile] }，取第一条
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        setProfile(json.data[0] as CompanyProfile);
      } else if (json.success && json.data && !Array.isArray(json.data)) {
        // 兼容老格式（单个对象）
        setProfile(json.data as CompanyProfile);
      } else {
        setError(json.error || '暂无公司信息');
      }
    } catch (e: any) {
      setError(e?.message || '网络错误');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500 text-xs">加载公司信息中…</span>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="p-4 text-xs text-gray-400">
        ⚠️ {error || '暂无数据'}
        <button onClick={fetchProfile} className="ml-2 text-blue-400 hover:underline">重试</button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 text-xs">
      {/* 标题区：公司全称 + 简称 */}
      <div>
        <div className="text-sm font-bold text-white">{profile.orgName || name}</div>
        <div className="text-gray-500 mt-0.5">
          {profile.name} · {profile.code}
        </div>
      </div>

      {/* 关键信息卡片 */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="所属行业" value={profile.areaBoard} />
        <Field label="上市市场" value={profile.tradeMarket} />
        <Field label="上市日期" value={profile.listingDate} />
        <Field label="成立日期" value={profile.foundDate} />
        <Field label="注册资本" value={profile.regCapitalFormatted} />
        <Field label="董事长" value={profile.chairman} />
        <Field label="控股股东" value={profile.controlHolder} fullWidth />
        <Field
          label="毛利率"
          value={profile.grossProfitRatio > 0 ? `${profile.grossProfitRatio.toFixed(2)}%` : '-'}
          tone={profile.grossProfitRatio > 30 ? 'positive' : profile.grossProfitRatio > 0 ? 'neutral' : 'muted'}
        />
        <Field label="主营业务" value={profile.mainBusiness} fullWidth />
        <Field label="营收结构" value={profile.incomeStructure} fullWidth />
      </div>

      {/* 公司简介 */}
      {profile.orgProfile && (
        <div>
          <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1.5">公司简介</div>
          <div className="text-gray-300 leading-relaxed bg-[#0f0f1e] rounded p-2.5">
            {profile.orgProfile}
          </div>
        </div>
      )}

      {/* 联系方式 */}
      {(profile.orgTel || profile.orgEmail || profile.orgWeb || profile.address) && (
        <div>
          <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1.5">联系方式</div>
          <div className="space-y-1 bg-[#0f0f1e] rounded p-2.5">
            {profile.orgTel && <ContactRow icon="📞" label="电话" value={profile.orgTel} />}
            {profile.orgEmail && <ContactRow icon="📧" label="邮箱" value={profile.orgEmail} />}
            {profile.orgWeb && (
              <ContactRow
                icon="🌐"
                label="官网"
                value={profile.orgWeb}
                href={profile.orgWeb.startsWith('http') ? profile.orgWeb : `https://${profile.orgWeb}`}
              />
            )}
            {profile.address && <ContactRow icon="📍" label="地址" value={profile.address} />}
          </div>
        </div>
      )}

      <div className="text-[10px] text-gray-600 text-right">数据来源：东方财富 F10</div>
    </div>
  );
}

function Field({ label, value, fullWidth, tone }: { label: string; value?: string; fullWidth?: boolean; tone?: 'positive' | 'negative' | 'neutral' | 'muted' }) {
  const display = value || '-';
  const toneClass =
    tone === 'positive' ? 'text-rose-400' :
    tone === 'negative' ? 'text-emerald-400' :
    tone === 'muted' ? 'text-gray-500' : 'text-white';
  return (
    <div className={fullWidth ? 'col-span-2' : ''}>
      <div className="text-gray-500 text-[10px] mb-0.5">{label}</div>
      <div className={`text-xs ${toneClass} break-words`}>{display}</div>
    </div>
  );
}

function ContactRow({ icon, label, value, href }: { icon: string; label: string; value: string; href?: string }) {
  const content = href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:text-blue-300 hover:underline"
    >
      {value} ↗
    </a>
  ) : (
    <span className="text-gray-200">{value}</span>
  );
  return (
    <div className="flex items-start gap-2">
      <span className="text-gray-500 w-3 shrink-0">{icon}</span>
      <span className="text-gray-500 w-8 shrink-0">{label}</span>
      <span className="flex-1 break-all">{content}</span>
    </div>
  );
}

// ==================== 新闻 Tab ====================

function NewsPanel({ code, name }: { code: string; name: string }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stock/news?code=${encodeURIComponent(code)}&type=company&pageSize=15`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setItems(json.data as NewsItem[]);
      } else if (json.success && json.data?.list) {
        // 兼容不同返回结构
        setItems(json.data.list as NewsItem[]);
      } else {
        setError(json.error || '暂无新闻');
      }
    } catch (e: any) {
      setError(e?.message || '网络错误');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { fetchNews(); }, [fetchNews]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500 text-xs">加载新闻中…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-xs text-gray-400">
        ⚠️ {error}
        <button onClick={fetchNews} className="ml-2 text-blue-400 hover:underline">重试</button>
      </div>
    );
  }

  if (items.length === 0) {
    return <div className="p-6 text-center text-gray-500 text-xs">该股票暂无近期新闻</div>;
  }

  return (
    <div className="p-2 space-y-2">
      {items.map(item => (
        <NewsCard key={item.id} item={item} />
      ))}
      <div className="text-[10px] text-gray-600 text-right pr-2 py-2">数据来源：东方财富 · 共 {items.length} 条</div>
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const sentimentColor =
    item.sentiment === 'positive' ? 'border-rose-700/60 bg-rose-950/20' :
    item.sentiment === 'negative' ? 'border-emerald-700/60 bg-emerald-950/20' :
    'border-[#2d2d3d] bg-[#0f0f1e]';
  const sentimentIcon =
    item.sentiment === 'positive' ? '📈' :
    item.sentiment === 'negative' ? '📉' : '📰';

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block p-2.5 rounded border ${sentimentColor} hover:border-blue-500/60 transition-colors`}
    >
      <div className="flex items-start gap-2 mb-1">
        <span className="text-sm shrink-0">{sentimentIcon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-white font-medium leading-snug line-clamp-2">
            {item.isImportant && <span className="text-amber-400 mr-1">★</span>}
            {item.title}
          </div>
        </div>
      </div>
      {item.content && (
        <div className="text-[11px] text-gray-400 leading-relaxed line-clamp-2 mb-1.5 pl-6">
          {item.content}
        </div>
      )}
      <div className="flex items-center gap-1.5 pl-6 flex-wrap">
        {item.tags.map(t => (
          <span
            key={t}
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              t === '利好' ? 'bg-rose-900/40 text-rose-300' :
              t === '利空' ? 'bg-emerald-900/40 text-emerald-300' :
              t === '重大' ? 'bg-amber-900/40 text-amber-300' :
              'bg-[#2d2d3d] text-gray-400'
            }`}
          >
            {t}
          </span>
        ))}
        <span className="text-[10px] text-gray-500 ml-auto">
          {item.source} · {item.publishTime?.slice(0, 16) || ''}
        </span>
      </div>
    </a>
  );
}

// ==================== 异动 Tab ====================

const ALERT_TYPE_META: Record<AlertItem['alertType'], { label: string; bg: string; text: string; icon: string }> = {
  zt:  { label: '涨停', bg: 'bg-rose-900/40 border-rose-700', text: 'text-rose-300', icon: '🚀' },
  dt:  { label: '跌停', bg: 'bg-emerald-900/40 border-emerald-700', text: 'text-emerald-300', icon: '💥' },
  yd:  { label: '异动', bg: 'bg-amber-900/40 border-amber-700', text: 'text-amber-300', icon: '⚡' },
  lhb: { label: '龙虎榜', bg: 'bg-purple-900/40 border-purple-700', text: 'text-purple-300', icon: '🐉' },
};

function AlertsPanel({ code, name }: { code: string; name: string }) {
  const [groups, setGroups] = useState<{ type: AlertItem['alertType']; items: AlertItem[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 拉取所有 4 种类型（涨停/跌停/异动/龙虎榜），按 code 过滤
  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const types: AlertItem['alertType'][] = ['zt', 'dt', 'yd', 'lhb'];
      const results = await Promise.allSettled(
        types.map(t => fetch(`/api/stock/alerts?type=${t}&pageSize=50`).then(r => r.json()))
      );
      // 归一化
      const allAlerts: AlertItem[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.success && Array.isArray(r.value.data)) {
          const t = types[i];
          // /api/stock/alerts 返回的字段: code, name, alertType, alertReason, publishTime, changePercent, ...
          const arr = (r.value.data as any[]).map(a => ({ ...a, alertType: a.alertType || t }));
          allAlerts.push(...(arr as AlertItem[]));
        }
      });

      // 按 code 过滤（同时支持 .SH/.SZ 后缀）
      const cleanCode = code.replace(/\.(SH|SZ|BJ)$/i, '');
      const matched = allAlerts.filter(a => {
        const aCode = a.code.replace(/\.(SH|SZ|BJ)$/i, '');
        return aCode === cleanCode || aCode === code;
      });

      // 按类型分组
      const grouped: Record<string, AlertItem[]> = {};
      matched.forEach(a => {
        if (!grouped[a.alertType]) grouped[a.alertType] = [];
        grouped[a.alertType].push(a);
      });
      // 排序：先 zt，再 dt，再 yd，再 lhb
      const order: AlertItem['alertType'][] = ['zt', 'dt', 'yd', 'lhb'];
      const result = order
        .filter(t => grouped[t]?.length > 0)
        .map(t => ({ type: t, items: grouped[t] }));
      setGroups(result);
    } catch (e: any) {
      setError(e?.message || '网络错误');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500 text-xs">拉取异动数据中…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-xs text-gray-400">
        ⚠️ {error}
        <button onClick={fetchAlerts} className="ml-2 text-blue-400 hover:underline">重试</button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500 text-xs">
        📭 该股票近期无涨跌停/异动记录
        <div className="text-[10px] mt-2 text-gray-600">（从涨停/跌停/异动/龙虎榜 4 个池子匹配）</div>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-3">
      {groups.map(g => (
        <AlertGroup key={g.type} type={g.type} items={g.items} />
      ))}
      <div className="text-[10px] text-gray-600 text-right pr-2 py-2">数据来源：东方财富 · {groups.reduce((s, g) => s + g.items.length, 0)} 条</div>
    </div>
  );
}

function AlertGroup({ type, items }: { type: AlertItem['alertType']; items: AlertItem[] }) {
  const meta = ALERT_TYPE_META[type];
  return (
    <div className={`rounded border ${meta.bg} overflow-hidden`}>
      <div className={`px-2.5 py-1.5 ${meta.bg} border-b ${meta.bg} flex items-center gap-2`}>
        <span className="text-sm">{meta.icon}</span>
        <span className={`text-xs font-bold ${meta.text}`}>{meta.label}</span>
        <span className="text-[10px] text-gray-500 ml-auto">{items.length} 次</span>
      </div>
      <div className="divide-y divide-[#2d2d3d]">
        {items.map((a, i) => (
          <div key={i} className="px-2.5 py-2 hover:bg-[#2d2d3d]/40">
            <div className="flex items-start gap-2">
              <div className={`text-xs font-mono font-bold ${a.changePercent >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {a.changePercent >= 0 ? '+' : ''}{a.changePercent.toFixed(2)}%
              </div>
              <div className="flex-1 min-w-0 text-xs text-gray-300">
                {a.alertReason || '异动原因未披露'}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
              <span>💰 ¥{a.closePrice.toFixed(2)}</span>
              {a.turnover > 0 && <span>换手 {a.turnover.toFixed(2)}%</span>}
              {a.amount > 0 && <span>成交 {(a.amount / 1e8).toFixed(2)}亿</span>}
              <span className="ml-auto">{a.publishTime?.slice(0, 16) || ''}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
