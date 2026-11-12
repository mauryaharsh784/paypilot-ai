import { z } from 'zod';
import { Types } from 'mongoose';
import { AgentRun, ChatSession, Product, User } from './models';
import { llmEnabled, runJSON, Tool } from './llm';
import * as T from './tools';
import { prepareOrder } from './payments';
import { inr } from './http';
import { config } from './config';

/* ------------------------------------------------------------------ registry */
export const AGENTS = {
  shopping: { name: 'Shopping Agent', responsibility: 'Turns the message into a structured shopping intent and asks for missing details.', tools: ['get_user_preferences', 'get_cart_summary'], output: 'ShoppingIntent' },
  research: { name: 'Research Agent', responsibility: 'Searches the product database and returns candidate products. Ids are verified against the database.', tools: ['search_products', 'get_product'], output: 'ResearchReport' },
  comparison: { name: 'Comparison Agent', responsibility: 'Compares specs, prices and features; names strengths and limitations.', tools: ['compare_products'], output: 'ComparisonReport' },
  budget: { name: 'Budget Agent', responsibility: 'Checks affordability, totals, warnings, value for money and cheaper alternatives.', tools: ['analyze_budget'], output: 'BudgetReport' },
  payment: { name: 'Payment Agent', responsibility: 'Validates the cart and prepares an order for approval. It cannot charge anyone: payment starts only when the user approves in the checkout screen.', tools: ['prepare_checkout', 'get_my_orders'], output: 'PaymentReport' },
} as const;
type AgentKey = keyof typeof AGENTS;

/* ------------------------------------------------------------------ schemas */
const strs = z.array(z.string()).nullish().transform((v) => v ?? []);
const Intent = z.object({
  action: z.enum(['search', 'add_to_cart', 'remove_from_cart', 'set_quantity', 'show_cart', 'compare', 'checkout', 'order_help', 'chat']),
  category: z.string().nullish(),
  maxBudget: z.number().positive().nullish(),
  useCases: strs, mustHave: strs, brands: strs,
  quantity: z.number().int().min(0).max(10).nullish(),
  productRefs: strs,
  clarifyingQuestions: strs,
});
type Intent = z.infer<typeof Intent>;

const Research = z.object({ candidateIds: z.array(z.string()).max(8), note: z.string().nullish() });
const Comparison = z.object({
  summary: z.string().min(1),
  topPickId: z.string().nullish(),
  perProduct: z.array(z.object({ productId: z.string(), why: z.string(), strengths: strs, limitations: strs })).default([]),
});
const BudgetR = z.object({ verdict: z.string().min(1), warnings: strs, valueRankingIds: strs, cheaperAlternativeIds: strs });
const PaymentR = z.object({ summary: z.string().min(1), issues: strs });
const OrderHelp = z.object({ answer: z.string().min(1) });

/* ------------------------------------------------------------------ tools exposed to agents */
const obj = (properties: any, required: string[] = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
function toolbox(userId: string): Record<string, Tool> {
  const idList = { type: 'array', items: { type: 'string' } };
  return {
    get_user_preferences: { name: 'get_user_preferences', description: "The user's saved shopping preferences (brands, categories, budget, specs).", parameters: obj({ verbose: { type: 'boolean' } }), run: async () => (await User.findById(userId).lean())?.preferences ?? {} },
    get_cart_summary: { name: 'get_cart_summary', description: "The user's current cart with totals.", parameters: obj({ verbose: { type: 'boolean' } }), run: () => T.getCartSummary(userId) },
    search_products: { name: 'search_products', description: 'Search the real product database. Returns ranked products within the price range plus near-miss products slightly above it.', parameters: obj({ query: { type: 'string' }, category: { type: 'string', description: T.CATEGORIES.join(' | ') }, maxPrice: { type: 'number' }, minPrice: { type: 'number' }, brands: idList, useCases: idList, mustHave: idList, limit: { type: 'number' } }), run: (a) => T.searchProducts(a) },
    get_product: { name: 'get_product', description: 'Full details of one product by id.', parameters: obj({ productId: { type: 'string' } }, ['productId']), run: (a) => T.getProduct(a.productId) },
    compare_products: { name: 'compare_products', description: 'Side-by-side spec table with the best and worst product per row.', parameters: obj({ productIds: idList }, ['productIds']), run: (a) => T.compareProducts(a.productIds || []) },
    analyze_budget: { name: 'analyze_budget', description: 'Totals, budget utilization, warnings, value ranking and cheaper alternatives for products.', parameters: obj({ productIds: idList, budget: { type: 'number' } }, ['productIds']), run: (a) => T.analyzeBudget(a.productIds || [], a.budget) },
    prepare_checkout: { name: 'prepare_checkout', description: 'Validate the cart and create an order that waits for the user to approve payment. Does not charge anything.', parameters: obj({ verbose: { type: 'boolean' } }), run: async () => { const o = await prepareOrder(userId); return { orderId: String(o._id), totalInr: o.total, itemCount: o.items.length, status: o.status }; } },
    get_my_orders: { name: 'get_my_orders', description: "The user's latest orders with payment status and transactions.", parameters: obj({ verbose: { type: 'boolean' } }), run: () => T.getMyOrders(userId) },
  };
}

type Ctx = { userId: string; trace: any[] };
type Use = (name: string, args?: any) => Promise<any>;

async function runAgent<O>(key: AgentKey, ctx: Ctx, o: { system: string; user: string; schema: z.ZodType<O, any, any>; fallback: (use: Use) => Promise<O> | O }): Promise<O> {
  const started = Date.now();
  const calls: any[] = [];
  const box = toolbox(ctx.userId);
  const wrap = (name: string): Tool => ({
    ...box[name],
    run: async (args: any) => { const t0 = Date.now(); try { return await box[name].run(args); } finally { calls.push({ name, args, ms: Date.now() - t0 }); } },
  });
  const use: Use = (name, args = {}) => wrap(name).run(args);
  let mode: 'llm' | 'rules' = 'rules';
  let error: string | undefined;
  let out: O | undefined;
  if (llmEnabled()) {
    try {
      out = await runJSON(o.schema, o.system, o.user, AGENTS[key].tools.map(wrap));
      mode = 'llm';
    } catch (e: any) { error = e.message; calls.length = 0; }
  }
  if (out === undefined) out = await o.fallback(use);
  ctx.trace.push({ agent: AGENTS[key].name, mode, tools: calls, ms: Date.now() - started, ...(error ? { llmError: error.slice(0, 160) } : {}) });
  return out;
}

/* ------------------------------------------------------------------ rules-mode intent parsing */
const CAT_WORDS: Record<string, RegExp> = {
  laptops: /\b(laptops?|notebooks?|ultrabooks?)\b/i,
  phones: /\b(phones?|smartphones?|mobiles?)\b/i,
  audio: /\b(headphones?|earbuds?|earphones?|headsets?|neckbands?|audio)\b/i,
  monitors: /\b(monitors?|displays?|screens?)\b/i,
  accessories: /\b(mouse|keyboards?|hubs?|accessor(y|ies))\b/i,
};
export const matchCategory = (s?: string | null) => {
  if (!s) return null;
  const l = s.toLowerCase();
  return T.CATEGORIES.find((c) => c === l || c.startsWith(l.replace(/s$/, ''))) || Object.keys(CAT_WORDS).find((c) => CAT_WORDS[c].test(l)) || null;
};
function parseBudget(s: string): number | null {
  const m = s.match(/(?:under|below|within|budget(?:\s+of)?|max(?:imum)?|up\s*to|upto|less than|around|about)\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(k|lakhs?|lacs?|l)?/i)
    || s.match(/(?:₹|rs\.?\s*|inr\s*)([\d,]+(?:\.\d+)?)\s*(k|lakhs?|lacs?|l)?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  const u = (m[2] || '').toLowerCase();
  if (u === 'k') n *= 1000; else if (u) n *= 100000;
  return n > 0 ? Math.round(n) : null;
}
const ORD: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4 };
function heuristicIntent(msg: string, last: any[]): Intent {
  const m = msg.toLowerCase();
  const category = Object.keys(CAT_WORDS).find((c) => CAT_WORDS[c].test(m)) || null;
  const tokens = T.normalizeTokens(m);
  const useCases = tokens.filter((t) => ['programming', 'multitasking', 'gaming', 'student', 'travel', 'portable', 'battery', 'camera', 'audio', 'calls', 'noise-cancelling', 'wireless', 'work', 'creative', 'fitness', 'budget', 'premium'].includes(t));
  const refs: string[] = [];
  const ord = Object.keys(ORD).find((k) => new RegExp(`\\b${k}\\b`).test(m));
  const num = m.match(/(?:#|number |option |no\.? )(\d)/);
  const pick = ord ? ORD[ord] : num ? Number(num[1]) : null;
  if (pick && last[pick - 1]) refs.push(String(last[pick - 1]._id));
  else if (/\b(it|this|that|top pick|best one)\b/.test(m) && last[0]) refs.push(String(last[0]._id));
  const base = { category, maxBudget: parseBudget(msg), useCases, mustHave: [], brands: [], quantity: Number(m.match(/\b(\d{1,2})\s*(?:x|units?|pieces?|pcs)\b/)?.[1]) || null, productRefs: refs, clarifyingQuestions: [] as string[] };
  let action: Intent['action'] = 'chat';
  if (/\b(check ?out|place (the )?order|pay now|proceed to pay|buy (it|now|this))\b/.test(m)) action = 'checkout';
  else if (/\b(remove|delete|take out)\b/.test(m)) action = 'remove_from_cart';
  else if (/\b(add|put)\b.*\b(cart|basket)\b|\badd (it|this|that|the)\b/.test(m)) action = 'add_to_cart';
  else if (/\b(change|set|update)\b.*\b(quantity|qty)\b/.test(m)) action = 'set_quantity';
  else if (/\b(compare|versus| vs\.? |difference)\b/.test(m)) action = 'compare';
  else if (/\b(my cart|show (the )?cart|what'?s in (my )?cart|cart summary)\b/.test(m)) action = 'show_cart';
  else if (/\b(order|refund|transaction|payment status|paid|invoice|receipt|delivery|failed payment)\b/.test(m) && !category) action = 'order_help';
  else if (category || base.maxBudget || useCases.length || /\b(need|looking for|want|recommend|suggest|find|show me)\b/.test(m)) action = 'search';
  return { action, ...base };
}

/* ------------------------------------------------------------------ explainability */
function budgetFit(p: any, budget?: number | null) {
  if (!budget) return 'No budget set. Tell me a maximum and I will check the fit.';
  if (p.price > budget) return `${inr(p.price - budget)} over your ${inr(budget)} budget.`;
  return `Within budget: ${inr(p.price)} is ${Math.round((p.price / budget) * 100)}% of ${inr(budget)}, leaving ${inr(budget - p.price)}.`;
}
function explain(p: any, rank: number, all: any[], intent: Intent, cmp: any, bud: any, llm?: any, topId?: string) {
  const wanted = Array.from(new Set([...intent.useCases, ...intent.mustHave].flatMap((x) => T.normalizeTokens(x)))).filter((t) => all.some((a) => a.tags.includes(t)));
  const matches = wanted.filter((t) => p.tags.includes(t));
  const misses = wanted.filter((t) => !p.tags.includes(t));
  const other = all.find((a) => a.id !== p.id && (rank === 0 ? true : a.id === all[0].id));
  let vs = 'Only option that fit your filters.';
  if (other) {
    const dp = p.price - other.price;
    const perfD = (p.specs?.perf ?? 0) - (other.specs?.perf ?? 0);
    vs = `Compared with ${other.name}: ${dp === 0 ? 'same price' : dp < 0 ? `${inr(-dp)} cheaper` : `${inr(dp)} more`}${perfD ? `, ${perfD > 0 ? '+' : ''}${perfD} performance index` : ''}, rating ${p.rating} vs ${other.rating}.`;
  }
  const pp = cmp.perProduct[p.id] || { pros: [], cons: [] };
  const val = bud.valueRanking.find((v: any) => v.id === p.id);
  return {
    rank: rank + 1, isTopPick: p.id === topId, valueScore: val?.valueScore ?? null,
    why: llm?.why || (matches.length ? `Matches ${matches.join(', ')}${misses.length ? ` but not ${misses.join(', ')}` : ''}; rated ${p.rating}/5 from ${p.reviews.toLocaleString('en-IN')} reviews.` : `Best overall fit among available ${p.category}; rated ${p.rating}/5.`),
    matches, misses,
    vsAlternatives: vs,
    budgetFit: budgetFit(p, intent.maxBudget),
    strengths: [...(llm?.strengths || []), ...pp.pros].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4),
    limitations: [...(llm?.limitations || []), ...pp.cons, ...misses.map((m: string) => `Not tagged for ${m}`)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4),
  };
}

/* ------------------------------------------------------------------ product reference resolution */
async function resolveRef(ref: string, last: any[]): Promise<any | null> {
  if (Types.ObjectId.isValid(ref)) { const p = await Product.findById(ref).lean(); if (p) return p; }
  const l = ref.toLowerCase();
  const hit = last.find((p) => p.name.toLowerCase().includes(l) || l.includes(p.name.toLowerCase()));
  if (hit) return hit;
  const words = l.split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return null;
  const all = await Product.find({ active: true }).lean();
  return all.map((p: any) => ({ p, s: words.filter((w) => p.name.toLowerCase().includes(w)).length })).filter((x) => x.s >= Math.min(2, words.length)).sort((a, b) => b.s - a.s)[0]?.p ?? null;
}

/* ------------------------------------------------------------------ the orchestrator */
const SYSTEM_RULES = 'You work inside PayPilot AI. Never invent products, prices or specs: use only data returned by your tools. Reply with ONLY one JSON object, no prose, no markdown.';

/**
 * Public entry point. Runs the agent pipeline and records one AgentRun row (success or failure) for admin monitoring.
 * Privacy: only a 120-char preview of the message is stored, and none at all when the user turned AI memory off.
 */
export async function handleMessage(userId: string, message: string) {
  const t0 = Date.now();
  const memoryOn = (await User.findById(userId).select('settings').lean())?.settings?.aiMemory !== false;
  const preview = memoryOn ? message.slice(0, 120) : '[hidden: user disabled AI memory]';
  const compact = (trace: any[]) => trace.map((x) => ({ agent: x.agent, mode: x.mode, ms: x.ms, tools: (x.tools || []).map((c: any) => c.name), llmError: x.llmError }));
  try {
    const reply = await runPipeline(userId, message);
    await AgentRun.create({ userId, message: preview, action: reply.intent?.action, mode: reply.mode, ok: true, durationMs: Date.now() - t0, cards: reply.cards?.length || 0, agents: compact(reply.trace || []) }).catch((e) => console.error('AgentRun log failed', e.message));
    return reply;
  } catch (e: any) {
    await AgentRun.create({ userId, message: preview, mode: llmEnabled() ? `llm:${config.ai.provider}` : 'rules', ok: false, error: String(e.message).slice(0, 200), durationMs: Date.now() - t0 }).catch(() => {});
    throw e;
  }
}

async function runPipeline(userId: string, message: string) {
  const trace: any[] = [];
  const ctx: Ctx = { userId, trace };
  const [user, session0] = await Promise.all([User.findById(userId).lean(), ChatSession.findOne({ userId })]);
  const session = session0 || (await ChatSession.create({ userId, messages: [], lastResults: [] }));
  const lastDocs = await Product.find({ _id: { $in: session.lastResults } }).lean();
  const last = session.lastResults.map((id: any) => lastDocs.find((p: any) => String(p._id) === String(id))).filter(Boolean) as any[];
  const memoryOn = user?.settings?.aiMemory !== false;
  const prefs: any = memoryOn ? user?.preferences || {} : {};
  const history = session.messages.slice(-6).map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 300) }));

  // 1. Shopping Agent
  const raw = await runAgent('shopping', ctx, {
    system: `${SYSTEM_RULES}
You are the Shopping Agent. Convert the user's message into this JSON:
{"action":"search|add_to_cart|remove_from_cart|set_quantity|show_cart|compare|checkout|order_help|chat","category":"laptops|phones|audio|monitors|accessories|null","maxBudget":number in INR or null,"useCases":["programming","gaming",...],"mustHave":[],"brands":[],"quantity":number|null,"productRefs":["product ids from lastShownProducts, or names"],"clarifyingQuestions":["ask only what is truly missing"]}
Rules: "under ₹50,000" means maxBudget 50000. "the first one" refers to lastShownProducts[0]. If the user wants to buy/pay use action checkout. If there is no clear product category for a search, put a question in clarifyingQuestions. Use get_user_preferences only when saved preferences could fill a gap.`,
    user: JSON.stringify({ message, recentConversation: history, lastShownProducts: last.map((p, i) => ({ n: i + 1, id: String(p._id), name: p.name })), savedPreferences: prefs }),
    schema: Intent,
    fallback: async () => heuristicIntent(message, last),
  });
  const intent: Intent = { ...raw, category: matchCategory(raw.category), maxBudget: raw.maxBudget ?? undefined };
  let usedPrefs = false;
  if (intent.action === 'search') {
    if (!intent.maxBudget && prefs.maxBudget) { intent.maxBudget = prefs.maxBudget; usedPrefs = true; }
    if (!intent.brands.length && prefs.brands?.length) { intent.brands = prefs.brands; usedPrefs = true; }
    if (!intent.category && prefs.categories?.length === 1) { intent.category = prefs.categories[0]; usedPrefs = true; }
  }

  let out: any;
  switch (intent.action) {
    case 'search': out = await searchFlow(ctx, intent, usedPrefs, session); break;
    case 'compare': out = await compareFlow(ctx, intent, last, session); break;
    case 'add_to_cart': case 'remove_from_cart': case 'set_quantity': case 'show_cart': out = await cartFlow(ctx, intent, last); break;
    case 'checkout': out = await checkoutFlow(ctx); break;
    case 'order_help': out = await orderHelpFlow(ctx, message); break;
    default:
      out = { message: intent.clarifyingQuestions[0] ? 'I can help you find, compare and buy products. A bit more detail will help.' : "I can find products, compare them against your budget, manage your cart and prepare a PayPal checkout. Try: “I need a laptop under ₹50,000 for programming and occasional gaming.”", questions: intent.clarifyingQuestions };
  }
  const reply = {
    questions: [], cards: [], budget: null, comparison: null, cart: null, approval: null, remember: null,
    ...out, intent, trace, mode: llmEnabled() ? `llm:${config.ai.provider}` : 'rules',
  };
  session.messages.push({ role: 'user', content: message, at: new Date() }, { role: 'assistant', content: reply.message, data: { ...reply, trace: undefined }, at: new Date() });
  if (session.messages.length > 60) session.messages = session.messages.slice(-60);
  session.markModified('messages');
  await session.save();
  return reply;
}

/* ---------- search ---------- */
async function searchFlow(ctx: Ctx, intent: Intent, usedPrefs: boolean, session: any) {
  const hasSignal = intent.category || intent.useCases.length || intent.mustHave.length;
  if (!hasSignal) {
    return { message: 'What kind of product do you want me to look for?', questions: intent.clarifyingQuestions.length ? intent.clarifyingQuestions : ['Which category: laptops, phones, audio, monitors or accessories?', 'What is your maximum budget?'] };
  }
  const searchArgs = { query: '', category: intent.category, maxPrice: intent.maxBudget, brands: intent.brands, useCases: intent.useCases, mustHave: intent.mustHave, limit: 6 };

  // 2. Research Agent
  const research = await runAgent('research', ctx, {
    system: `${SYSTEM_RULES}
You are the Research Agent. Call search_products (once or twice) using the intent, then reply {"candidateIds":["<product id from tool results>", ...up to 5, best first],"note":"one sentence on what you found"}. Never output an id you did not get from a tool.`,
    user: JSON.stringify({ intent }),
    schema: Research,
    fallback: async (use) => { const r = await use('search_products', searchArgs); return { candidateIds: r.results.map((p: any) => p.id), note: undefined }; },
  });
  // Verify against the database: drop invented ids, enforce the budget as a hard limit, top up from the deterministic search.
  const det = await T.searchProducts(searchArgs);
  const docs = await Product.find({ _id: { $in: research.candidateIds.filter((i) => Types.ObjectId.isValid(i)) }, active: true, stock: { $gt: 0 } }).lean();
  let ids = research.candidateIds.filter((i) => docs.some((d: any) => String(d._id) === i && (!intent.maxBudget || d.price <= intent.maxBudget)));
  for (const p of det.results) { if (ids.length >= 4) break; if (!ids.includes(p.id)) ids.push(p.id); }
  ids = ids.slice(0, 4);

  if (!ids.length) {
    const near = det.nearMisses;
    return {
      message: near.length ? `Nothing matched within ${inr(intent.maxBudget!)}. ${near.map((p: any) => `${p.name} is ${inr(p.price)}`).join(' and ')} would be just above it. Want me to raise the budget a little?` : `I could not find products that match${intent.maxBudget ? ` within ${inr(intent.maxBudget)}` : ''}. Try a higher budget or fewer requirements.`,
      questions: ['Raise my budget slightly', 'Show everything in this category'],
      cards: near.map((p: any, i: number) => ({ product: p, explain: { rank: i + 1, why: 'Slightly above your budget but otherwise a close match.', matches: [], misses: [], vsAlternatives: '', budgetFit: budgetFit(p, intent.maxBudget), strengths: [], limitations: ['Over budget'], valueScore: null, isTopPick: false } })),
    };
  }

  // 3 + 4. Comparison and Budget agents run in parallel
  const [cmpData, budData] = await Promise.all([T.compareProducts(ids), T.analyzeBudget(ids, intent.maxBudget)]);
  const [cmp, bud] = await Promise.all([
    runAgent('comparison', ctx, {
      system: `${SYSTEM_RULES}
You are the Comparison Agent. Call compare_products with the candidate ids, then reply {"summary":"3-4 sentences naming the top pick and how it fits the user's needs","topPickId":"id","perProduct":[{"productId":"id","why":"one sentence","strengths":["..."],"limitations":["..."]}]}. Ground every claim in the tool data.`,
      user: JSON.stringify({ intent, candidateIds: ids }),
      schema: Comparison,
      fallback: async (use) => {
        const c = await use('compare_products', { productIds: ids });
        const top = c.products[0];
        const needs = intent.useCases.length ? ` for ${intent.useCases.join(', ')}` : '';
        return { summary: `${top.name} is my top pick${needs}. It is ${inr(top.price)} with a ${top.rating}/5 rating${c.perProduct[top.id]?.pros?.length ? ` and stands out for: ${c.perProduct[top.id].pros.join(', ').toLowerCase()}` : ''}.${c.products[1] ? ` ${c.products[1].name} is the closest alternative at ${inr(c.products[1].price)}.` : ''}`, topPickId: top.id, perProduct: [] };
      },
    }),
    runAgent('budget', ctx, {
      system: `${SYSTEM_RULES}
You are the Budget Agent. Call analyze_budget with the candidate ids and the user's budget, then reply {"verdict":"2 sentences on affordability and value for money","warnings":["..."],"valueRankingIds":["ids best value first"],"cheaperAlternativeIds":["ids from the tool's cheaperAlternatives"]}.`,
      user: JSON.stringify({ budget: intent.maxBudget ?? null, candidateIds: ids }),
      schema: BudgetR,
      fallback: async (use) => {
        const b = await use('analyze_budget', { productIds: ids, budget: intent.maxBudget });
        const best = b.valueRanking[0];
        return { verdict: intent.maxBudget ? `Everything shown fits within ${inr(intent.maxBudget)}. ${best.name} gives the best value for money (score ${best.valueScore}/100).` : `${best.name} gives the best value for money (score ${best.valueScore}/100). Set a maximum budget and I will check affordability.`, warnings: [], valueRankingIds: [], cheaperAlternativeIds: [] };
      },
    }),
  ]);

  const byId = new Map(cmpData.products.map((p: any) => [p.id, p]));
  const topId = cmp.topPickId && byId.has(cmp.topPickId) ? cmp.topPickId : ids[0];
  const ordered = [topId, ...ids.filter((i) => i !== topId)].map((i) => byId.get(i)).filter(Boolean) as any[];
  const cards = ordered.map((p, i) => ({ product: p, explain: explain(p, i, ordered, intent, cmpData, budData, cmp.perProduct.find((x) => x.productId === p.id), topId) }));
  session.lastResults = ordered.map((p) => new Types.ObjectId(p.id));

  const questions: string[] = [];
  if (!intent.maxBudget) questions.push('What is your maximum budget?');
  else if (!intent.useCases.length && intent.category === 'laptops') questions.push('What will you mostly use it for: coding, gaming, study, creative work?');
  const warnings = Array.from(new Set([...budData.warnings, ...bud.warnings]));
  const remember = { brands: intent.brands, categories: intent.category ? [intent.category] : [], maxBudget: intent.maxBudget ?? null, specs: intent.mustHave };
  return {
    message: `${cmp.summary}\n\n${bud.verdict}${usedPrefs ? '\n\nI used your saved preferences for budget or brand where you did not specify one.' : ''}${research.note ? `\n\n${research.note}` : ''}`,
    questions, cards,
    budget: { ...budData, warnings, verdict: bud.verdict, usedPreferences: usedPrefs },
    comparison: ordered.length > 1 ? cmpData : null,
    remember: remember.brands.length || remember.categories.length || remember.maxBudget || remember.specs.length ? remember : null,
  };
}

/* ---------- compare ---------- */
async function compareFlow(ctx: Ctx, intent: Intent, last: any[], session: any) {
  const picked: any[] = [];
  for (const r of intent.productRefs) { const p = await resolveRef(r, last); if (p && !picked.some((x) => String(x._id) === String(p._id))) picked.push(p); }
  const base = picked.length >= 2 ? picked : last.slice(0, 3);
  if (base.length < 2) return { message: 'I need at least two products to compare. Ask me to find some first, for example “best phones under ₹30,000”.' };
  const ids = base.slice(0, 4).map((p) => String(p._id));
  const [cmpData, budData] = await Promise.all([T.compareProducts(ids), T.analyzeBudget(ids, intent.maxBudget)]);
  const cmp = await runAgent('comparison', ctx, {
    system: `${SYSTEM_RULES}
You are the Comparison Agent. Call compare_products, then reply {"summary":"3-4 sentences on the key trade-offs","topPickId":"id","perProduct":[{"productId":"id","why":"one sentence","strengths":[],"limitations":[]}]}.`,
    user: JSON.stringify({ candidateIds: ids }), schema: Comparison,
    fallback: async (use) => {
      const c = await use('compare_products', { productIds: ids });
      const lines = c.products.map((p: any) => `${p.name} (${inr(p.price)}): ${(c.perProduct[p.id]?.pros || []).join(', ') || 'balanced'}`);
      return { summary: `Here is how they compare. ${lines.join('. ')}.`, topPickId: c.products[0].id, perProduct: [] };
    },
  });
  const ordered = cmpData.products;
  const topId = cmp.topPickId && ordered.some((p: any) => p.id === cmp.topPickId) ? cmp.topPickId : ordered[0].id;
  const cards = ordered.map((p: any, i: number) => ({ product: p, explain: explain(p, i, ordered, intent, cmpData, budData, cmp.perProduct.find((x) => x.productId === p.id), topId) }));
  session.lastResults = ordered.map((p: any) => new Types.ObjectId(p.id));
  return { message: cmp.summary, cards, comparison: cmpData, budget: { ...budData, verdict: '', usedPreferences: false } };
}

/* ---------- cart ---------- */
async function cartFlow(ctx: Ctx, intent: Intent, last: any[]) {
  const t0 = Date.now();
  const calls: any[] = [];
  const done = (extra: any) => { ctx.trace.push({ agent: 'Cart tools', mode: 'rules', tools: calls, ms: Date.now() - t0 }); return extra; };
  if (intent.action === 'show_cart') {
    const cart = await T.getCartSummary(ctx.userId); calls.push({ name: 'get_cart_summary' });
    return done({ message: cart.items.length ? `You have ${cart.itemCount} item${cart.itemCount > 1 ? 's' : ''} totalling ${inr(cart.total)}.${cart.warnings.length ? ' ' + cart.warnings.join(' ') : ''}` : 'Your cart is empty.', cart });
  }
  const cart0 = await T.getCartSummary(ctx.userId);
  const target = async (ref: string) => (await resolveRef(ref, last)) || cart0.items.map((i) => ({ _id: i.productId, name: i.name })).find((i) => i.name.toLowerCase().includes(ref.toLowerCase()));
  const refs = intent.productRefs.length ? intent.productRefs : last[0] && intent.action === 'add_to_cart' ? [String(last[0]._id)] : [];
  if (!refs.length) return done({ message: intent.action === 'add_to_cart' ? 'Which product should I add? Ask me to search first, then say “add the first one”.' : 'Which item do you mean?', cart: cart0 });
  const msgs: string[] = [];
  let cart = cart0;
  for (const ref of refs.slice(0, 3)) {
    const p: any = await target(ref);
    if (!p) { msgs.push(`I could not find “${ref}”.`); continue; }
    const id = String(p._id);
    try {
      if (intent.action === 'add_to_cart') {
        calls.push({ name: 'cart_add', args: { productId: id } });
        const r = await T.cartAdd(ctx.userId, id, intent.quantity || 1, true);
        msgs.push(r.message); cart = r.cart;
      } else {
        calls.push({ name: 'cart_set_quantity', args: { productId: id } });
        const q = intent.action === 'remove_from_cart' ? 0 : intent.quantity ?? 1;
        const r = await T.cartSetQuantity(ctx.userId, id, q);
        msgs.push(q === 0 ? `Removed ${p.name} from your cart.` : `Set ${p.name} to quantity ${q}.`); cart = r.cart;
      }
    } catch (e: any) { msgs.push(e.message); }
  }
  return done({ message: `${msgs.join(' ')} Cart total: ${inr(cart.total)}.`, cart });
}

/* ---------- checkout (prepare only) ---------- */
async function checkoutFlow(ctx: Ctx) {
  let order: any = null;
  const rep = await runAgent('payment', ctx, {
    system: `${SYSTEM_RULES}
You are the Payment Agent. Call prepare_checkout once. You can NEVER charge money; the user approves payment themselves. Reply {"summary":"one or two sentences telling the user their order is ready for review and approval","issues":["problems from the tool, if any"]}.`,
    user: JSON.stringify({ request: 'prepare checkout for the current cart' }), schema: PaymentR,
    fallback: async (use) => { const r = await use('prepare_checkout'); return { summary: `Your order is ready: ${r.itemCount} line item${r.itemCount > 1 ? 's' : ''} for ${inr(r.totalInr)}. Review it and approve to continue to PayPal.`, issues: [] }; },
  }).catch((e) => ({ summary: e.message, issues: [e.message], failed: true } as any));
  if (!rep.failed) {
    const { Order } = await import('./models');
    order = await Order.findOne({ userId: ctx.userId, status: 'awaiting_approval' }).sort({ createdAt: -1 }).lean();
  }
  if (!order) return { message: rep.summary };
  return {
    message: `${rep.summary}\n\nNothing has been charged. Payment starts only after you approve the order on the checkout screen.`,
    approval: { orderId: String(order._id), total: order.total, chargeAmount: order.chargeAmount, chargeCurrency: order.chargeCurrency, items: order.items.map((i: any) => ({ name: i.name, quantity: i.quantity, price: i.price })) },
  };
}

/* ---------- post-purchase help ---------- */
const REFUND_NOTE = 'PayPilot cannot issue refunds from chat. For a refund, contact support with your order ID and PayPal capture ID, or open a dispute from your PayPal account.';
async function orderHelpFlow(ctx: Ctx, question: string) {
  const r = await runAgent('payment', ctx, {
    system: `${SYSTEM_RULES}
You are the Payment Agent helping after a purchase. Call get_my_orders, then reply {"answer":"a short, factual answer based only on the tool data"}. Never claim a refund was issued. Status meanings: paid = PayPal capture verified; awaiting_payment = PayPal order created but not captured; failed/cancelled = no money taken by PayPilot.`,
    user: JSON.stringify({ question }), schema: OrderHelp,
    fallback: async (use) => {
      const orders = await use('get_my_orders');
      if (!orders.length) return { answer: 'You have no orders yet.' };
      const o = orders[0];
      const meaning: Record<string, string> = { paid: 'Payment was captured and verified.', awaiting_payment: 'The PayPal order exists but payment has not been completed.', awaiting_approval: 'The order is waiting for your approval at checkout.', cancelled: 'The order was cancelled and nothing was captured.', failed: `The payment failed${o.failureReason ? `: ${o.failureReason}` : ''}.` };
      return { answer: `Your latest order (${o.orderId.slice(-8)}) is ${o.status.replace('_', ' ')}. ${meaning[o.status] || ''} Items: ${o.items.join(', ')}.` };
    },
  });
  const refund = /refund|money back|cancel|dispute/i.test(question) ? `\n\n${REFUND_NOTE}` : '';
  return { message: r.answer + refund };
}
