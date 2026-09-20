import { agentModelSpec, createModelClient, type ModelClient } from './model.js';

/**
 * `npm run model:ping -- [provider:model]`: checks that a key works and that the model can do the three things the agent
 * relies on: plain chat, tool calling (including sending a tool result back, which is where Gemini 3 needs its thought
 * signature echoed), and JSON output. Costs about four tiny requests.
 */
const spec = process.argv[2] ?? agentModelSpec();

async function attempt(name: string, fn: () => Promise<string>): Promise<boolean> {
  const started = Date.now();
  try {
    console.log(`  PASS ${name}: ${await fn()} (${Date.now() - started}ms)`);
    return true;
  } catch (err) {
    console.log(`  FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function checks(client: ModelClient): Promise<boolean[]> {
  return [
    await attempt('plain chat', async () => {
      const r = await client.chat({ messages: [{ role: 'user', content: 'Reply with exactly the word OK.' }], temperature: 0 });
      if (!r.content?.trim()) throw new Error('empty reply');
      return `${JSON.stringify(r.content.trim().slice(0, 40))}, ${r.usage.promptTokens}+${r.usage.completionTokens} tokens`;
    }),
    await attempt('tool calling', async () => {
      const tools = [{ name: 'add', description: 'Add two integers.', parameters: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'] } }];
      const first = await client.chat({ messages: [{ role: 'user', content: 'Use the add tool to compute 17 + 25.' }], tools, temperature: 0 });
      const call = first.toolCalls[0];
      if (!call) throw new Error(`the model did not call the tool (replied: ${JSON.stringify(first.content?.slice(0, 80))})`);
      const args = JSON.parse(call.arguments) as { a?: number; b?: number };
      if (call.name !== 'add' || Number(args.a) + Number(args.b) !== 42) throw new Error(`wrong call: ${call.name} ${call.arguments}`);
      // Send the result back: proves the provider accepts our tool-result message shape and that any signature survives.
      const second = await client.chat({
        messages: [
          { role: 'user', content: 'Use the add tool to compute 17 + 25.' },
          { role: 'assistant', content: first.content, toolCalls: first.toolCalls },
          { role: 'tool', toolCallId: call.id, name: call.name, content: '42' },
        ],
        tools,
        temperature: 0,
      });
      if (!second.content?.includes('42')) throw new Error(`did not use the tool result (replied: ${JSON.stringify(second.content?.slice(0, 80))})`);
      return `called add(${args.a}, ${args.b}) and used the result${call.extraContent !== undefined ? ' (provider signature echoed)' : ''}`;
    }),
    await attempt('JSON mode', async () => {
      const r = await client.chat({ messages: [{ role: 'user', content: 'Return a JSON object with one key "ok" set to true.' }], json: true, temperature: 0 });
      const parsed = JSON.parse(r.content ?? '') as { ok?: unknown };
      if (parsed.ok !== true) throw new Error(`unexpected JSON: ${r.content}`);
      return 'valid JSON object';
    }),
  ];
}

try {
  const client = createModelClient(spec);
  console.log(`Pinging ${spec}`);
  const results = await checks(client);
  console.log(results.every(Boolean) ? 'All checks passed.' : 'Some checks failed.');
  process.exit(results.every(Boolean) ? 0 : 1);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}
