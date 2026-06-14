'use client';

/**
 * AI Strategy Assistant Component
 * 
 * A chat panel for AI-powered strategy consultation in the quant trading system.
 * Supports multiple modes: strategy, screener, explain, general.
 * Chat state is lifted to the parent page so messages persist across tab switches.
 */

import { useState, useRef, useEffect } from 'react';
import { Settings, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useSettingsStore } from '@/lib/store/settings';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { SettingsDialog } from '@/components/settings';
import type { ChatMessage, ChatMode, AIAction, ChatResponse } from '@/lib/types/quant-chat';

const modeLabels: Record<ChatMode, string> = {
  strategy: '策略咨询',
  screener: '智能选股',
  explain: '策略解释',
  general: '市场分析',
};

/**
 * Model status bar - shows current model and configuration state
 */
function ModelStatusBar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const modelConfig = getCurrentModelConfig();
  const isConfigured = !!(modelConfig.apiKey || modelConfig.isServerConfigured);
  const providerId = useSettingsStore((s) => s.providerId);
  const providersConfig = useSettingsStore((s) => s.providersConfig);
  const providerName = providersConfig[providerId]?.name || providerId;

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          {isConfigured ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 text-yellow-400" />
          )}
          <span className="text-xs text-slate-400">
            {isConfigured ? (
              <>当前模型: <span className="text-slate-200 font-medium">{providerName}</span> / <span className="text-slate-300">{modelConfig.modelId}</span></>
            ) : (
              <span className="text-yellow-400">未配置 AI 模型，请先设置 API 密钥</span>
            )}
          </span>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-md transition-colors text-slate-300"
        >
          <Settings className="w-3.5 h-3.5" />
          {isConfigured ? '切换模型' : '去设置'}
        </button>
      </div>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialSection="providers"
      />
    </>
  );
}

/**
 * Stock chip component for displaying recommended stocks
 */
function StockChip({ 
  code, 
  reason, 
  onClick 
}: { 
  code: string; 
  reason?: string; 
  onClick?: () => void;
}) {
  // Extract stock name from code (simplified - in real app would look up from data)
  const stockName = code.replace(/\.(SH|SZ|BJ)$/, '');
  
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-900/40 border border-blue-700 rounded-full text-sm hover:bg-blue-900/60 transition-colors"
    >
      <span className="text-blue-300 font-medium">{code}</span>
      {reason && (
        <span className="text-slate-400 text-xs">
          {reason.includes('📈') || reason.includes('低估') ? '📈' : '📊'}
          {reason}
        </span>
      )}
    </button>
  );
}

/**
 * Apply strategy button component
 */
function ApplyStrategyButton({ 
  strategy, 
  onClick 
}: { 
  strategy?: string; 
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors"
    >
      <span>应用策略</span>
      {strategy && <span className="text-green-200">({strategy})</span>}
    </button>
  );
}

/**
 * Loading indicator component
 */
function LoadingIndicator() {
  return (
    <div className="flex items-center gap-2 text-slate-500">
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-sm text-slate-500">AI思考中...</span>
    </div>
  );
}

interface AIStrategyAssistantProps {
  messages: ChatMessage[];
  onMessagesChange: (msgs: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}

export default function AIStrategyAssistant({
  messages,
  onMessagesChange,
  mode: activeMode,
  onModeChange: setActiveMode,
}: AIStrategyAssistantProps) {
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    const trimmedInput = inputValue.trim();
    if (!trimmedInput || isLoading) return;

    // Add user message
    const userMessage: ChatMessage = {
      role: 'user',
      content: trimmedInput,
      timestamp: Date.now(),
    };
    
    onMessagesChange(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      // Read model config client-side and pass to API
      const modelConfig = getCurrentModelConfig();
      const response = await fetch('/api/quant/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmedInput,
          mode: activeMode,
          context: {},
          modelConfig,
        }),
      });

      const data: ChatResponse = await response.json();

      if (!data.success) {
        setError(data.reply);
        // Add error as system message
        onMessagesChange(prev => [...prev, {
          role: 'assistant',
          content: data.reply,
          actions: data.actions,
          timestamp: Date.now(),
        }]);
      } else {
        // Add assistant message
        onMessagesChange(prev => [...prev, {
          role: 'assistant',
          content: data.reply,
          actions: data.actions,
          timestamp: Date.now(),
        }]);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '发送消息失败，请稍后重试';
      setError(errorMsg);
      onMessagesChange(prev => [...prev, {
        role: 'assistant',
        content: errorMsg,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStockClick = (code: string) => {
    // Navigate to screener with the stock pre-selected
    // This would typically use router or state management
    console.log('Navigate to screener with stock:', code);
    // For now, just log - in real implementation would navigate
    window.location.href = `/quant?screener=true&stock=${code}`;
  };

  const handleApplyStrategy = (strategy?: string) => {
    console.log('Apply strategy:', strategy);
    // In real implementation, this would trigger strategy application
  };

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
      {/* 模型状态栏 */}
      <ModelStatusBar />

      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700 bg-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">AI策略助手</h2>
          <p className="text-sm text-slate-400">专业的A股量化投资顾问</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => onMessagesChange([])}
            className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded border border-slate-700 hover:border-slate-600 transition-colors"
          >
            清空聊天
          </button>
        )}
      </div>

      {/* Mode selector tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-slate-700 bg-slate-800">
        {(Object.keys(modeLabels) as ChatMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setActiveMode(mode)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeMode === mode
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {modeLabels[mode]}
          </button>
        ))}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-4">🤖</div>
            <p className="text-slate-400 max-w-md">
              我是您的AI量化助手，可以帮您分析股票、生成策略、解释技术指标
            </p>
            <div className="mt-6 text-sm text-slate-500 space-y-2">
              <p>💡 您可以问我：</p>
              <ul className="text-left list-disc list-inside">
                <li>推荐近期适合的量化策略</li>
                <li>帮我筛选低估值的股票</li>
                <li>解释MACD指标的使用方法</li>
                <li>分析当前市场环境</li>
              </ul>
            </div>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div
              key={index}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-100 border border-slate-700'
                }`}
              >
                {/* Message content */}
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {msg.content}
                </div>

                {/* Actions from AI */}
                {msg.role === 'assistant' && msg.actions && msg.actions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-600">
                    <div className="flex flex-wrap gap-2">
                      {msg.actions.map((action, actionIndex) => {
                        if (action.type === 'show_stock' && action.code) {
                          return (
                            <StockChip
                              key={actionIndex}
                              code={action.code}
                              reason={action.reason}
                              onClick={() => handleStockClick(action.code!)}
                            />
                          );
                        }
                        if (action.type === 'apply_strategy') {
                          return (
                            <ApplyStrategyButton
                              key={actionIndex}
                              strategy={action.strategy}
                              onClick={() => handleApplyStrategy(action.strategy)}
                            />
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
              <LoadingIndicator />
            </div>
          </div>
        )}

        {/* Error message */}
        {error && !isLoading && (
          <div className="flex justify-center">
            <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-2 text-red-300 text-sm">
              {error}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="p-4 border-t border-slate-700 bg-slate-800">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? '等待AI回复...' : '输入您的问题...'}
            disabled={isLoading}
            className="flex-1 bg-slate-700 border border-slate-600 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed placeholder-slate-500"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !inputValue.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? '发送中...' : '发送'}
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          AI助手仅供参考，不构成投资建议。投资有风险，入市需谨慎。
        </p>
      </div>
    </div>
  );
}
