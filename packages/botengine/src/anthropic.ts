// Runner del turno con Claude (tool use via tool runner del SDK oficial).
import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';

import type { ToolDef } from './tools';
import type { ProviderTurn, TurnMessage } from './turn';

const DEFAULT_MODEL = 'claude-haiku-4-5'; // modelo economico (doc 01 §4)
// Mismos parametros operativos que el runner de OpenAI (auditoria 2026-08-07):
// exactitud sobre creatividad, y un cuelgue del proveedor corta en 30 s.
const TEMPERATURE = 0.1;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 1;

export const runAnthropicTurn: ProviderTurn = async ({
  apiKey,
  model,
  system,
  history,
  tools,
  maxTokens,
}) => {
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES });

  const finalMessage = await client.beta.messages.toolRunner({
    model: model ?? DEFAULT_MODEL,
    max_tokens: maxTokens,
    temperature: TEMPERATURE,
    system,
    tools: tools.map((tool: ToolDef) =>
      betaTool({
        name: tool.name,
        description: tool.description,
        // El JSON Schema propio es un subconjunto del que tipa el SDK.
        inputSchema: tool.parameters as unknown as Parameters<typeof betaTool>[0]['inputSchema'],
        run: (args) => tool.run((args ?? {}) as Record<string, string>),
      }),
    ),
    messages: history.map((m: TurnMessage) => ({ role: m.role, content: m.content })),
    max_iterations: 6,
  });

  const reply = finalMessage.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim();

  return {
    reply: reply.length > 0 ? reply : null,
    inputTokens: finalMessage.usage.input_tokens,
    outputTokens: finalMessage.usage.output_tokens,
  };
};
