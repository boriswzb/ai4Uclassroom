/**
 * AI Strategy Chat API Route
 * 
 * POST /api/quant/ai-chat - AI-powered strategy chat for quant trading
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { verifyRequestUser } from '@/lib/server/quant-auth';

const log = createLogger('AIChatAPI');

export const maxDuration = 120;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AIAction {
  type: 'show_stock' | 'apply_strategy' | 'navigate';
  code?: string;
  reason?: string;
  strategy?: string;
  params?: Record<string, unknown>;
  tab?: string;
}

interface AIChatResponse {
  success: boolean;
  reply: string;
  actions: AIAction[];
  charts: Array<{ type: string; data: unknown }>;
}

type ChatMode = 'strategy' | 'screener' | 'explain' | 'general';

/**
 * System prompt for the AI quant trading assistant
 */
function buildSystemPrompt(mode: ChatMode): string {
  const basePrompt = `你是专业的A股量化投资顾问，基于VeighNa架构设计。你的职责是：

1. 策略咨询 - 根据市场情况推荐合适的量化策略
2. 智能选股 - 基于财务数据和技术指标筛选股票
3. 策略解释 - 解释各种技术指标的原理和使用方法
4. 风险提示 - 提醒用户注意风险管理，不推荐具体买卖点位

重要约束：
- 不推荐具体的买卖价格或精确点位
- 始终强调止损和风险管理的重要性
- 解释策略背后的逻辑，帮助用户理解
- 回答应当简洁、专业、有建设性

市场背景：
- A股市场实行T+1交易制度
- 涨跌幅限制为10%（ST股5%，科创板/创业板20%）
- 股票代码格式：沪市以.SH结尾（如600000.SH），深市以.SZ结尾（如000001.SZ）

当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
`;

  const modePrompts: Record<ChatMode, string> = {
    strategy: `${basePrompt}

当前模式：策略咨询
你可以分析当前市场环境，推荐适合的量化策略，如MACD、KDJ、均线系统、布林带等。`,
    screener: `${basePrompt}

当前模式：智能选股
你可以根据用户的要求筛选股票，如低估值、高成长、技术突破等。返回的股票应该附带代码和筛选理由。`,
    explain: `${basePrompt}

当前模式：策略解释
你可以详细解释各种技术指标的计算方法、使用技巧和注意事项，如MACD、KDJ、RSI、布林带等。`,
    general: `${basePrompt}

当前模式：市场分析
你可以回答关于A股市场的一般性问题，提供市场分析和投资建议。`,
  };

  return modePrompts[mode] || modePrompts.general;
}

/**
 * Parse AI response to extract structured actions
 */
function parseAIResponse(content: string): { reply: string; actions: AIAction[] } {
  const actions: AIAction[] = [];
  
  // Try to find JSON block in response
  const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\{[\s\S]*?"actions"[\s\S]*?\}/);
  
  if (jsonMatch) {
    try {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      if (parsed.reply) {
        return {
          reply: parsed.reply,
          actions: parsed.actions || [],
        };
      }
    } catch {
      // JSON parse failed, continue with text processing
    }
  }
  
  // Extract stock mentions from text
  const stockPattern = /([\u4e00-\u9fa5]{2,6})\s*([0-9]{6}\.(SH|SZ|BJ))\s*([📈📉⬆⬇]+)?([^\s,，.。]+)?/g;
  let match;
  while ((match = stockPattern.exec(content)) !== null) {
    const [, name, code, , reason] = match;
    actions.push({
      type: 'show_stock',
      code,
      reason: reason || 'AI推荐关注',
    });
  }
  
  // Extract strategy mentions
  const strategyPatterns = ['MACD', 'KDJ', 'RSI', '布林带', '均线', 'MA', 'EMA', '海龟策略', '双均线'];
  for (const strategy of strategyPatterns) {
    if (content.includes(strategy)) {
      const strategyId = strategy.toLowerCase().replace(/[^a-z]/g, '');
      actions.push({
        type: 'apply_strategy',
        strategy: strategyId || strategy,
        reason: `推荐使用${strategy}策略`,
      });
      break; // Only add one strategy action
    }
  }
  
  return { reply: content, actions };
}

/**
 * Call the LLM API directly
 */
async function callLLM(params: {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  messages: ChatMessage[];
}): Promise<string> {
  const { apiKey, baseUrl, modelId, messages } = params;
  
  // Ensure baseUrl has correct format
  const base = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;
  
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  if (data.error) {
    throw new Error(`LLM error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return data.choices?.[0]?.message?.content || '';
}

export async function POST(req: NextRequest) {
  try {
    // 识别用户身份（用于日志，不强制登录）
    const user = await verifyRequestUser();
    const username = user.invited ? user.username : 'guest';

    const body = await req.json();
    const { message, mode = 'general', context = {} } = body as {
      message: string;
      mode: ChatMode;
      context: {
        currentStock?: string;
        selectedStrategy?: string;
        portfolio?: unknown[];
        marketData?: unknown;
      };
    };

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { success: false, reply: '请输入有效的问题', actions: [], charts: [] },
        { status: 400 }
      );
    }

    // Get LLM configuration from request body (passed from client)
    const modelConfig = (body.modelConfig || {}) as {
      apiKey?: string;
      baseUrl?: string;
      modelId?: string;
      providerId?: string;
      isServerConfigured?: boolean;
    };

    // Check if API key is configured
    if (!modelConfig.apiKey && !modelConfig.isServerConfigured) {
      return NextResponse.json({
        success: false,
        reply: '尚未配置AI模型。请前往设置页面配置您的AI API密钥和模型。\n\n路径：设置 → AI模型 → 选择提供商并输入API密钥',
        actions: [
          {
            type: 'navigate',
            tab: 'settings',
            params: { section: 'ai-model' },
          },
        ],
        charts: [],
      });
    }

    // Build messages
    const systemPrompt = buildSystemPrompt(mode);
    const userMessage = context.currentStock
      ? `[当前股票: ${context.currentStock}]\n[当前策略: ${context.selectedStrategy || '未选择'}]\n\n${message}`
      : message;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    // Call LLM
    let reply: string;
    try {
      log.info(`[${username}] LLM call start`, { mode, message: message.slice(0, 50) });
      reply = await callLLM({
        apiKey: modelConfig.apiKey || '',
        baseUrl: modelConfig.baseUrl || '',
        modelId: modelConfig.modelId || 'gpt-4o-mini',
        messages,
      });
      log.info(`[${username}] LLM call success`);
    } catch (error) {
      log.error(`[${username}] LLM call failed:`, error);
      return NextResponse.json({
        success: false,
        reply: `AI服务调用失败: ${error instanceof Error ? error.message : '未知错误'}。请检查API配置是否正确。`,
        actions: [],
        charts: [],
      });
    }

    // Parse response
    const { reply: parsedReply, actions } = parseAIResponse(reply);

    return NextResponse.json({
      success: true,
      reply: parsedReply,
      actions,
      charts: [],
    });
  } catch (error) {
    log.error('AI chat error:', error);
    return NextResponse.json(
      {
        success: false,
        reply: '处理请求时发生错误，请稍后重试。',
        actions: [],
        charts: [],
      },
      { status: 500 }
    );
  }
}
