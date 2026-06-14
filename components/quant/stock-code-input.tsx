'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/** 股票搜索结果 — 与 /api/stock/search 兼容 */
export interface StockSearchItem {
  code: string;       // 完整代码 000001.SZ
  name: string;       // 股票名称
  pinyin?: string;   // 拼音缩写
  exchange: 'SZ' | 'SH' | 'BJ';
  market?: string;
  type?: string;
}

interface StockCodeInputProps {
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

/**
 * 股票代码输入框 — 复用数据中心关键字搜索能力
 * 支持：输入代码/名称/拼音 → 下拉联想 → 键盘选择 → 粘贴直接填入
 */
export default function StockCodeInput({
  value,
  onChange,
  placeholder = '输入股票代码或名称...',
  className = '',
  inputClassName = '',
}: StockCodeInputProps) {
  const [input, setInput] = useState(value);
  const [suggestions, setSuggestions] = useState<StockSearchItem[]>([]);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Sync external value changes (e.g. parent resets)
  useEffect(() => {
    setInput(value);
  }, [value]);

  // Click outside to close
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShow(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = useCallback((keyword: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!keyword.trim()) {
      setSuggestions([]);
      setShow(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/stock/search?q=${encodeURIComponent(keyword.trim())}&limit=8`
        );
        const json = await res.json();
        setSuggestions(json.data || []);
        setShow(true);
        setHighlighted(-1);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 200);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    setHighlighted(-1);
    search(val);
  };

  const select = useCallback(
    (s: StockSearchItem) => {
      setInput(s.code);
      onChange(s.code);
      setShow(false);
      setSuggestions([]);
    },
    [onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!show || suggestions.length === 0) {
      // Enter with no suggestions → treat input as raw code
      if (e.key === 'Enter') {
        e.preventDefault();
        const trimmed = input.trim();
        if (trimmed) {
          // Normalize: append .SZ or .SH if missing
          const normalized = normalizeCode(trimmed);
          onChange(normalized);
          setShow(false);
        }
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((p) => Math.min(p + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((p) => Math.max(p - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = highlighted >= 0 ? highlighted : 0;
      if (suggestions[idx]) {
        select(suggestions[idx]);
      } else {
        // Fallback: normalize what user typed
        const normalized = normalizeCode(input.trim());
        onChange(normalized);
        setShow(false);
      }
    } else if (e.key === 'Escape') {
      setShow(false);
    }
  };

  const handleFocus = () => {
    if (input.trim()) setShow(true);
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
          {loading ? (
            <span className="animate-spin inline-block">⟳</span>
          ) : (
            <span>🔍</span>
          )}
        </span>
        <input
          type="text"
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder={placeholder}
          className={`w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-600 text-white rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inputClassName}`}
          autoComplete="off"
        />
      </div>

      {/* Suggestions dropdown */}
      {show && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 overflow-hidden max-h-64 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={s.code}
              onClick={() => select(s)}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-700 transition-colors ${
                highlighted === i ? 'bg-slate-700' : ''
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={`text-sm font-bold shrink-0 ${
                    s.exchange === 'SH'
                      ? 'text-blue-400'
                      : s.exchange === 'BJ'
                      ? 'text-orange-400'
                      : 'text-green-400'
                  }`}
                >
                  {s.name}
                </span>
                <span className="text-xs text-slate-500 shrink-0">
                  {s.code.split('.')[0]}
                </span>
                {s.pinyin && (
                  <span className="text-xs text-slate-600 shrink-0">
                    {s.pinyin.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-500">{s.market}</span>
                {s.type && s.type !== '股票' && (
                  <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                    {s.type}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 把用户输入规范化为带交易所后缀的代码 */
function normalizeCode(raw: string): string {
  const cleaned = raw.replace(/[.\s]/g, '');
  // 已经是6位纯数字
  if (/^\d{6}$/.test(cleaned)) {
    if (cleaned.startsWith('6') || cleaned.startsWith('5')) {
      return `${cleaned}.SH`;
    }
    if (cleaned.startsWith('8') || cleaned.startsWith('4')) {
      return `${cleaned}.BJ`;
    }
    return `${cleaned}.SZ`;
  }
  // 已经是完整格式如 000001.SZ
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(raw)) return raw;
  // 带了前导0.xxx格式
  if (/^\d+\.\d+$/.test(raw)) {
    const parts = raw.split('.');
    const code = parts[0].padStart(6, '0');
    const exchange = parts[1].toUpperCase();
    if (['SH', 'SZ', 'BJ'].includes(exchange)) return `${code}.${exchange}`;
  }
  // 非标准格式直接返回原值
  return raw;
}
