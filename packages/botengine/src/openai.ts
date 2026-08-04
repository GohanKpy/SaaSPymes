// Runner del turno con OpenAI (Chat Completions + function calling).
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

import type { ProviderTurn } from './turn';

const DEFAULT_MODEL = 'gpt-4o-mini'; // modelo economico (ADR 0002)
const MAX_ITERATIONS = 6;

export const runOpenAiTurn: ProviderTurn = async ({
  apiKey,
  model,
  system,
  history,
  tools,
  maxTokens,
}) => {
  const client = new OpenAI({ apiKey });

  const definitions: ChatCompletionTool[] = tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as Record<string, unknown>,
    },
  }));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  let inputTokens = 0;
  let outputTokens = 0;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const completion = await client.chat.completions.create({
      model: model ?? DEFAULT_MODEL,
      max_tokens: maxTokens,
      messages,
      ...(definitions.length > 0 ? { tools: definitions } : {}),
    });
    inputTokens += completion.usage?.prompt_tokens ?? 0;
    outputTokens += completion.usage?.completion_tokens ?? 0;

    const choice = completion.choices[0];
    if (!choice) break;
    const message = choice.message;

    if (!message.tool_calls || message.tool_calls.length === 0) {
      const reply = (message.content ?? '').trim();
      return { reply: reply.length > 0 ? reply : null, inputTokens, outputTokens };
    }

    messages.push(message);
    for (const call of message.tool_calls) {
      if (call.type !== 'function') continue;
      const tool = byName.get(call.function.name);
      let result: string;
      try {
        const args = JSON.parse(call.function.arguments || '{}') as Record<string, string>;
        result = tool ? await tool.run(args) : `herramienta desconocida: ${call.function.name}`;
      } catch (error) {
        result = `error: ${error instanceof Error ? error.message : 'fallo la herramienta'}`;
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }

  return { reply: null, inputTokens, outputTokens };
};
