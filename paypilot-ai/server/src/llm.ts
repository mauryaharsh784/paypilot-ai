import { z } from 'zod';
import { config } from './config';

export type Tool = { name: string; description: string; parameters: any; run: (args: any) => Promise<any> };

export const llmEnabled = () => config.ai.provider !== 'none' && !!(config.ai.provider === 'gemini' ? config.ai.geminiKey : config.ai.openaiKey);

const clip = (v: any) => JSON.stringify(v).slice(0, 14000);

async function openai(system: string, user: string, tools: Tool[], maxSteps: number) {
  const messages: any[] = [{ role: 'system', content: system }, { role: 'user', content: user }];
  for (let step = 0; step <= maxSteps; step++) {
    const body: any = { model: config.ai.openaiModel, messages, temperature: 0.2 };
    if (tools.length && step < maxSteps) {
      body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    }
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ai.openaiKey}` },
      body: JSON.stringify(body),
    });
    const j: any = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `OpenAI error ${r.status}`);
    const msg = j.choices[0].message;
    messages.push(msg);
    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        const tool = tools.find((t) => t.name === tc.function.name);
        let out: any;
        try { out = tool ? await tool.run(JSON.parse(tc.function.arguments || '{}')) : { error: 'Unknown tool' }; }
        catch (e: any) { out = { error: e.message }; }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: clip(out) });
      }
      continue;
    }
    return msg.content || '';
  }
  return '';
}

async function gemini(system: string, user: string, tools: Tool[], maxSteps: number) {
  const contents: any[] = [{ role: 'user', parts: [{ text: user }] }];
  for (let step = 0; step <= maxSteps; step++) {
    const body: any = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.2 } };
    if (tools.length && step < maxSteps) {
      body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
    }
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.ai.geminiModel}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.ai.geminiKey },
      body: JSON.stringify(body),
    });
    const j: any = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `Gemini error ${r.status}`);
    const content = j.candidates?.[0]?.content;
    if (!content?.parts) throw new Error('Gemini returned no content');
    contents.push(content);
    const calls = content.parts.filter((p: any) => p.functionCall);
    if (calls.length) {
      const parts: any[] = [];
      for (const c of calls) {
        const tool = tools.find((t) => t.name === c.functionCall.name);
        let out: any;
        try { out = tool ? await tool.run(c.functionCall.args || {}) : { error: 'Unknown tool' }; }
        catch (e: any) { out = { error: e.message }; }
        parts.push({ functionResponse: { name: c.functionCall.name, response: { result: JSON.parse(clip(out)) } } });
      }
      contents.push({ role: 'user', parts });
      continue;
    }
    return content.parts.map((p: any) => p.text || '').join('');
  }
  return '';
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('No JSON object in model reply');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Runs a tool-calling agent loop and returns output validated against a zod schema (one repair retry). */
export async function runJSON<T>(schema: z.ZodType<T, any, any>, system: string, user: string, tools: Tool[], maxSteps = 4): Promise<T> {
  const call = config.ai.provider === 'gemini' ? gemini : openai;
  let text = await call(system, user, tools, maxSteps);
  try { return schema.parse(extractJson(text)); }
  catch (err: any) {
    text = await call(system, `${user}\n\nYour previous reply was rejected: ${String(err.message).slice(0, 400)}\nReply again with ONLY the corrected JSON object.`, [], 0);
    return schema.parse(extractJson(text));
  }
}
