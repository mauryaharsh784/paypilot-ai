import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Bot, Brain, ChevronDown, Loader2, PiggyBank, Send, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, Trash2, Wallet } from 'lucide-react';
import { api, useFetch } from '../lib/api';
import { inr } from '../lib/format';
import { ProductCard } from '../components/ProductCard';
import { CompareTable } from './Catalog';
import { PageHead } from '../components/ui';
import { ProductImage } from '../components/ProductImage';
import { useApp } from '../store';

const starters = [
  'I need a laptop under ₹50,000 for programming, multitasking and occasional gaming',
  'Best phone under ₹30,000 with a good camera',
  'Noise cancelling headphones for travel under ₹12,000',
];

function Reply({ m, send }: { m: any; send: (t: string) => void }) {
  const navigate = useNavigate();
  const { toast, refresh } = useApp();
  const [trace, setTrace] = useState(false);
  const [cmp, setCmp] = useState(false);
  const remember = async () => {
    try { await api('/me/preferences/merge', { body: m.remember }); toast('Saved to your shopping memory'); } catch (e: any) { toast(e.message, 'bad'); }
  };
  const goApprove = () => { refresh(); navigate(`/checkout?order=${m.approval.orderId}`); };
  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3`}>
        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${m.error ? 'bg-bad/10 text-bad' : 'bg-brand text-white'}`}>{m.error ? <AlertTriangle className="h-4 w-4" /> : <Bot className="h-4 w-4" />}</span>
        <div className={`min-w-0 max-w-3xl whitespace-pre-line rounded-2xl rounded-tl-md border px-4 py-3 text-sm leading-relaxed shadow-card ${m.error ? 'border-bad/30 bg-bad/5 text-bad' : 'border-line bg-white'}`} role={m.error ? 'alert' : undefined}>{m.message || m.content}</div>
      </div>
      {m.cards?.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {m.cards.map((c: any) => (
            <ProductCard key={c.product.id} p={c.product}>
              <div className="space-y-2.5 rounded-xl bg-paper p-3 text-xs leading-relaxed">
                <div className="flex flex-wrap items-center gap-2">
                  {c.explain.isTopPick && <span className="badge bg-brand text-white"><Sparkles className="h-3 w-3" />Top pick</span>}
                  {c.explain.valueScore != null && (
                    <span className="flex min-w-[120px] flex-1 items-center gap-2 text-muted" title="Value score from catalog price, rating and specs"><span className="shrink-0 font-semibold text-ink">Value {c.explain.valueScore}/100</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, c.explain.valueScore))}%` }} /></span></span>
                  )}
                </div>
                <p><b className="text-ink">Why this one:</b> {c.explain.why}</p>
                {c.explain.vsAlternatives && <p><b className="text-ink">Vs. alternatives:</b> {c.explain.vsAlternatives}</p>}
                <p className="flex gap-1.5"><Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" /><span><b className="text-ink">Budget:</b> {c.explain.budgetFit}</span></p>
                {c.explain.strengths.length > 0 && <div><div className="flex items-center gap-1 font-semibold text-ok"><ThumbsUp className="h-3 w-3" />Strengths</div><ul className="mt-0.5 space-y-0.5 pl-4">{c.explain.strengths.map((x: string) => <li key={x} className="list-disc">{x}</li>)}</ul></div>}
                {c.explain.limitations.length > 0 && <div><div className="flex items-center gap-1 font-semibold text-warn"><ThumbsDown className="h-3 w-3" />Limitations</div><ul className="mt-0.5 space-y-0.5 pl-4">{c.explain.limitations.map((x: string) => <li key={x} className="list-disc">{x}</li>)}</ul></div>}
              </div>
            </ProductCard>
          ))}
        </div>
      )}
      {m.budget && (
        <div className="card p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold"><PiggyBank className="h-4 w-4 text-brand" />Budget check{m.budget.budget ? ` · ${inr(m.budget.budget)} maximum` : ''}</div>
          {m.budget.warnings?.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-warn">{m.budget.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul>}
          {m.budget.cheaperAlternatives?.length > 0 && (
            <p className="mt-2 text-muted">Cheaper alternatives: {m.budget.cheaperAlternatives.map((p: any) => <Link key={p.id} to={`/product/${p.id}`} className="inline-flex items-center gap-0.5 font-semibold text-brand hover:underline">{p.name} (save {inr(p.saves)})<ArrowUpRight className="h-3 w-3" /></Link>).reduce((a: any, b: any) => [a, ', ', b])}</p>
          )}
        </div>
      )}
      {m.comparison && (
        <div><button className="btn-ghost btn-sm" onClick={() => setCmp(!cmp)}>{cmp ? 'Hide' : 'Show'} full comparison</button>
          {cmp && <div className="mt-3"><CompareTable data={m.comparison} /></div>}</div>
      )}
      {m.cart && m.cart.items.length > 0 && (
        <div className="card p-4 text-sm">
          <ul className="divide-y divide-line">{m.cart.items.map((i: any) => <li key={i.productId} className="flex items-center gap-3 py-2"><div className="w-14 shrink-0 overflow-hidden rounded-lg"><ProductImage p={i} pad="p-0.5" /></div><span className="min-w-0 flex-1">{i.quantity} × {i.name}</span><span className="font-semibold">{inr(i.lineTotal)}</span></li>)}</ul>
          <div className="mt-2 flex items-center justify-between font-semibold"><span>Total {inr(m.cart.total)}</span><Link to="/cart" className="btn-ghost btn-sm">Open cart</Link></div>
        </div>
      )}
      {m.approval && (
        <div className="card border-brand/40 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-brand" />Order ready for your approval</div>
          <ul className="mt-2 text-muted">{m.approval.items.map((i: any) => <li key={i.name}>{i.quantity} × {i.name}</li>)}</ul>
          <div className="mt-2">Total {inr(m.approval.total)} · charged as {m.approval.chargeAmount} {m.approval.chargeCurrency}</div>
          <p className="mt-1 text-xs text-muted">Nothing is charged yet. You review and approve on the next screen.</p>
          <button className="btn-primary mt-3" onClick={goApprove}>Review and approve payment</button>
        </div>
      )}
      {m.questions?.length > 0 && <div className="flex flex-wrap gap-2">{m.questions.map((q: string) => <button key={q} className="btn-ghost btn-sm" onClick={() => send(q)}>{q}</button>)}</div>}
      {m.remember && <button className="inline-flex items-center text-xs font-semibold text-brand" onClick={remember}><Brain className="mr-1 inline h-3.5 w-3.5" />Remember these preferences for next time</button>}
      {m.trace && (
        <div className="text-xs text-muted">
          <button className="flex items-center gap-1 font-semibold" onClick={() => setTrace(!trace)}>Agent activity ({m.mode}) <ChevronDown className={`h-3 w-3 transition ${trace ? 'rotate-180' : ''}`} /></button>
          {trace && <ul className="mt-2 space-y-1">{m.trace.map((t: any, i: number) => (
            <li key={i}><b>{t.agent}</b> · {t.mode} · {t.ms} ms{t.tools?.length ? ` · tools: ${t.tools.map((x: any) => x.name).join(', ')}` : ''}{t.llmError ? ` · fell back: ${t.llmError}` : ''}</li>))}</ul>}
        </div>
      )}
    </div>
  );
}

export default function Assistant() {
  const { data, loading, reload } = useFetch<any>('/assistant/session');
  const info = useFetch<any>('/config');
  const [items, setItems] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { refresh } = useApp();

  useEffect(() => { if (data) setItems(data.messages.map((x: any) => (x.role === 'user' ? x : { role: 'assistant', ...(x.data || {}), message: x.content }))); }, [data]);
  useEffect(() => { const el = box.current; if (el && (items.length > 0 || busy)) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [items, busy]);

  const send = async (msg: string) => {
    if (!msg.trim() || busy) return;
    setItems((p) => [...p, { role: 'user', content: msg }]); setText(''); setBusy(true);
    try { const r = await api('/assistant/message', { body: { message: msg } }); setItems((p) => [...p, { role: 'assistant', ...r }]); refresh(); }
    catch (e: any) { setItems((p) => [...p, { role: 'assistant', message: e.message, error: true }]); }
    finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); send(text); };
  const clear = async () => { await api('/assistant/session', { method: 'DELETE' }); setItems([]); reload(); };

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[480px] flex-col lg:h-[calc(100dvh-9.5rem)]">
      <PageHead title="AI shopping assistant" sub={`Agents run in ${info.data?.ai === 'rules' ? 'rules mode (add a Gemini or OpenAI key for LLM mode)' : `${info.data?.ai ?? '…'} mode`}. Every product comes from the catalog.`}
        right={items.length > 0 ? <button className="btn-ghost btn-sm" onClick={clear}><Trash2 className="h-3.5 w-3.5" />Clear chat</button> : undefined} />
      <div ref={box} className="flex-1 space-y-6 overflow-y-auto pr-1" aria-live="polite">
        {loading ? <div className="space-y-3"><div className="skeleton h-14 w-2/3" /><div className="skeleton ml-auto h-10 w-1/2" /></div> : items.length === 0 && (
          <div className="card card-pad mx-auto max-w-2xl text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand"><Sparkles className="h-6 w-6" /></span>
            <h2 className="mt-3 text-lg font-semibold">What do you want to buy?</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">Describe it in your own words, with a budget if you have one. The agents shortlist from the catalog and explain every pick.</p>
            <div className="mt-5 flex flex-col gap-2">{starters.map((s) => <button key={s} className="btn-ghost justify-start whitespace-normal text-left" onClick={() => send(s)}><Send className="h-3.5 w-3.5 shrink-0 text-brand" />{s}</button>)}</div>
          </div>
        )}
        {items.map((m, i) => m.role === 'user'
          ? <div key={i} className="flex justify-end"><div className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-sm text-white shadow-sm sm:max-w-[70%]">{m.content}</div></div>
          : <Reply key={i} m={m} send={send} />)}
        {busy && <div className="flex items-center gap-3" role="status"><span className="grid h-8 w-8 place-items-center rounded-full bg-brand text-white"><Bot className="h-4 w-4" /></span><div className="flex items-center gap-2 rounded-2xl rounded-tl-md border border-line bg-white px-4 py-3 text-sm text-muted shadow-card"><span className="flex gap-1" aria-hidden><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:-.3s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:-.15s]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand" /></span>The agents are researching your request…</div></div>}
      </div>
      <form onSubmit={submit} className="mt-3 flex items-center gap-2 rounded-2xl border border-line bg-white p-2 shadow-card focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        <input className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted/70" placeholder="e.g. add the first one to my cart" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} aria-label="Message" />
        <button className="btn-primary h-10 w-10 shrink-0 !p-0 sm:w-auto sm:!px-4" disabled={busy || !text.trim()} aria-label="Send message">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}<span className="hidden sm:inline">Send</span></button>
      </form>
    </div>
  );
}
