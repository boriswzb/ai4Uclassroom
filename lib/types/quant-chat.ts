/**
 * Shared types for the AI Strategy Assistant chat
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  actions?: AIAction[];
  timestamp: number;
}

export interface AIAction {
  type: 'show_stock' | 'apply_strategy' | 'navigate';
  code?: string;
  reason?: string;
  strategy?: string;
  params?: Record<string, unknown>;
  tab?: string;
}

export interface ChatResponse {
  success: boolean;
  reply: string;
  actions: AIAction[];
  charts: Array<{ type: string; data: unknown }>;
}

export type ChatMode = 'strategy' | 'screener' | 'explain' | 'general';
