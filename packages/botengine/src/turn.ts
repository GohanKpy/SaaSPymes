import type { ToolDef } from './tools';

export interface TurnMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProviderTurnInput {
  apiKey: string;
  model?: string;
  system: string;
  history: TurnMessage[];
  tools: ToolDef[];
  maxTokens: number;
}

export interface BotTurnResult {
  reply: string | null;
  inputTokens: number;
  outputTokens: number;
}

export type ProviderTurn = (input: ProviderTurnInput) => Promise<BotTurnResult>;
