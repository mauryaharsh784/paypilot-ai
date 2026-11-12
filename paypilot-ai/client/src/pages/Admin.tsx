import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, useFetch } from '../lib/api';
import { date, inr, short } from '../lib/format';
import { ErrorState, PageHead, Spinner, Status } from '../components/ui';
import { useApp } from '../store';

export default function Admin() {
  const stats = useFetch<any>('/admin/stats');
  const orders = useFetch<any>('/admin/orders');
  const hooks = useFetch<any>('/admin/webhooks');
  const prods = useFetch<any>('/admin/products');
  const users = useFetch<any>('/admin/users');
  const ai = useFetch<any>('/admin/ai-activity');
  const [tab, setTab] = useState<'overview' | 'users' | 'ai' | 'catalog'>('overview');
  const { toast, user: me } = useApp();
  const [edit, setEdit] = useState<Record<string, string>>({});
  if (stats.loading) return <Spinner />;
  if (stats.error || !stats.data) return <ErrorState message={stats.error || 'Could not load admin data'} retry={stats.reload} />;
  const s = stats.data;
  const setPrice = async (id: string) => {
    try { await api(`/admin/products/${id}`, { method: 'PUT', body: { price: Number(edit[id]) } }); toast('Price updated. Watchers were notified.'); setEdit({ ...edit, [id]: '' }); prods.reload(); }
    catch (e: any) { toast(e.message, 'bad'); }
  };
  const setRole = async (id: string, role: 'user' | 'admin') => {
    try { await api(`/admin/users/${id}`, { method: 'PATCH', body: { role } }); toast(`Role changed to ${role}`); users.reload(); }
    catch (e: any) { toast(e.message, 'bad'); }
  };
  const setStock = async (id: string, stock: number) => {
    try { await api(`/admin/products/${id}`, { method: 'PUT', body: { stock } }); prods.reload(); } catch (e: any) { toast(e.message, 'bad'); }
  };
  return (
    <>
      <PageHead title="Admin dashboard" sub="Operations, payments and AI monitoring. Figures come from database records." />
      <div className="mb-6 flex flex-wrap gap-1 border-b border-line" role="tablist">
        {([['overview', 'Overview'], ['users', 'Users'], ['ai', 'AI activity'], ['catalog', 'Catalog']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'}`}>{l}</button>)}
      </div>
      {tab === 'overview' && <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[['Users', s.users], ['Orders', s.orders], ['Paid orders', s.paidOrders], ['Revenue (INR)', inr(s.revenueInr)]].map(([l, v]) => <div key={String(l)} className="card p-4"><div className="text-xs text-muted">{l}</div><div className="mt-1 font-display text-xl font-semibold">{v}</div></div>)}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5"><h2 className="font-semibold">Revenue by day</h2>
          {s.revenueByDay.length ? <div className="mt-4 h-56"><ResponsiveContainer><BarChart data={s.revenueByDay}><CartesianGrid vertical={false} stroke="#E2E7F1" /><XAxis dataKey="day" fontSize={11} tickLine={false} axisLine={false} /><YAxis fontSize={11} tickLine={false} axisLine={false} /><Tooltip formatter={(v: any) => inr(v)} /><Bar dataKey="revenue" fill="#5B5BF0" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div> : <p className="mt-3 text-sm text-muted">No paid orders yet.</p>}</section>
        <section className="card p-5"><h2 className="font-semibold">Orders by status</h2>
          <ul className="mt-3 space-y-2 text-sm">{s.statusCounts.map((c: any) => <li key={c._id} className="flex items-center justify-between"><Status s={c._id} /><b>{c.n}</b></li>)}</ul>
          <p className="mt-4 text-xs text-muted">{s.webhookEvents} PayPal webhook events processed.</p></section>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[['Today', s.revenue.today], ['Last 7 days', s.revenue.last7Days], ['Last 30 days', s.revenue.last30Days], ['All time', s.revenue.allTime], ['Avg. order value', s.revenue.averageOrderValue]].map(([l, v]) => <div key={String(l)} className="card p-4"><div className="text-xs text-muted">Revenue · {l}</div><div className="mt-1 font-display font-semibold">{inr(Number(v))}</div></div>)}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5"><h2 className="font-semibold">Payment status overview</h2>
          <p className="mt-1 text-xs text-muted">Checkout conversion (paid / attempted): <b>{s.paymentOverview.conversion === null ? 'no attempts yet' : `${s.paymentOverview.conversion}%`}</b></p>
          {s.paymentOverview.byOutcome.length ? <ul className="mt-3 divide-y divide-line text-sm">{s.paymentOverview.byOutcome.map((o: any) => <li key={o.kind + o.status} className="flex items-center justify-between py-2"><span className="capitalize">{o.kind} · {o.status}</span><span><b>{o.count}</b> <span className="text-muted">({o.amount} in charge currency)</span></span></li>)}</ul> : <p className="mt-3 text-sm text-muted">No payment activity yet.</p>}
        </section>
        <section className="card p-5"><h2 className="font-semibold">Revenue by category</h2>
          {s.revenueByCategory.length ? <div className="mt-4 h-52"><ResponsiveContainer><BarChart data={s.revenueByCategory}><CartesianGrid vertical={false} stroke="#E2E7F1" /><XAxis dataKey="category" fontSize={11} tickLine={false} axisLine={false} /><YAxis fontSize={11} tickLine={false} axisLine={false} /><Tooltip formatter={(v: any) => inr(v)} /><Bar dataKey="revenue" fill="#0E9F6E" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div> : <p className="mt-3 text-sm text-muted">No paid orders yet.</p>}
        </section>
      </div>
      <section className="mt-6"><h2 className="mb-2 font-semibold">Recent orders</h2>
        {orders.loading ? <Spinner /> : <div className="card overflow-x-auto"><table className="w-full min-w-[620px]"><thead><tr className="border-b border-line"><th className="th">Order</th><th className="th">Customer</th><th className="th">Total</th><th className="th">Placed</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-line">{orders.data?.items.slice(0, 15).map((o: any) => <tr key={o._id}><td className="td font-semibold">#{short(o._id)}</td><td className="td">{o.userId?.email}</td><td className="td">{inr(o.total)}</td><td className="td">{date(o.createdAt)}</td><td className="td"><Status s={o.status} /></td></tr>)}</tbody></table></div>}</section>
      <section className="mt-6"><h2 className="mb-2 font-semibold">Webhook log</h2>
        {hooks.loading ? <Spinner /> : !hooks.data?.items.length ? <p className="text-sm text-muted">No webhook events received yet. Register the webhook URL in your PayPal sandbox app.</p> : <div className="card overflow-x-auto"><table className="w-full min-w-[560px]"><tbody className="divide-y divide-line">{hooks.data.items.map((h: any) => <tr key={h._id}><td className="td">{date(h.createdAt)}</td><td className="td font-mono text-xs">{h.eventType}</td><td className="td text-muted">{h.outcome || 'processing'}</td></tr>)}</tbody></table></div>}</section>
      </>}
      {tab === 'users' && <>
      <section className="mt-6"><h2 className="mb-2 font-semibold">User management</h2>
        {users.loading ? <Spinner /> : users.error ? <ErrorState message={users.error} retry={users.reload} /> : <div className="card overflow-x-auto"><table className="w-full min-w-[720px]"><thead><tr className="border-b border-line"><th className="th">User</th><th className="th">Joined</th><th className="th">Orders (paid)</th><th className="th">Spent</th><th className="th">AI runs</th><th className="th">Role</th></tr></thead>
          <tbody className="divide-y divide-line">{users.data.items.map((u: any) => <tr key={u.id}><td className="td"><div className="font-medium">{u.name}</div><div className="text-xs text-muted">{u.email}</div></td><td className="td">{date(u.createdAt)}</td><td className="td">{u.orders} ({u.paidOrders})</td><td className="td">{inr(u.spent)}</td><td className="td">{u.aiRuns}</td>
            <td className="td">{u.id === me?.id ? <span className="badge bg-paper text-muted">You (admin)</span> : <select className="input !w-28 !py-1.5" value={u.role} onChange={(e) => setRole(u.id, e.target.value as any)} aria-label={`Role for ${u.email}`}><option value="user">user</option><option value="admin">admin</option></select>}</td></tr>)}</tbody></table></div>}
        <p className="mt-2 text-xs text-muted">Showing {users.data?.items.length ?? 0} of {users.data?.total ?? 0} users. You cannot change your own role, and the last admin cannot be demoted.</p>
      </section>
      </>}
      {tab === 'ai' && <>
      <section className="mt-6"><h2 className="mb-2 font-semibold">AI activity monitoring</h2>
        {ai.loading ? <Spinner /> : ai.error ? <ErrorState message={ai.error} retry={ai.reload} /> : <>
          <div className="grid gap-4 sm:grid-cols-4">
            {[['Mode', ai.data.mode === 'rules' ? 'Rules (no LLM key)' : ai.data.mode], ['Total runs', s.ai.runs], ['Failed runs', s.ai.failed], ['Avg. latency', `${s.ai.avgMs} ms`]].map(([l, v]) => <div key={String(l)} className="card p-4"><div className="text-xs text-muted">{l}</div><div className="mt-1 font-display font-semibold">{v}</div></div>)}
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="card overflow-x-auto"><table className="w-full min-w-[420px]"><thead><tr className="border-b border-line"><th className="th">Agent</th><th className="th">Calls</th><th className="th">Tool calls</th><th className="th">Avg ms</th><th className="th">LLM fallbacks</th></tr></thead><tbody className="divide-y divide-line">{ai.data.byAgent.map((a: any) => <tr key={a.agent}><td className="td">{a.agent}</td><td className="td">{a.calls}</td><td className="td">{a.toolCalls}</td><td className="td">{a.avgMs}</td><td className="td">{a.llmFallbacks}</td></tr>)}</tbody></table></section>
            <section className="card p-5"><h3 className="text-sm font-semibold">Requests by intent</h3>{ai.data.byAction.length ? <div className="mt-3 h-40"><ResponsiveContainer><BarChart data={ai.data.byAction}><CartesianGrid vertical={false} stroke="#E2E7F1" /><XAxis dataKey="action" fontSize={11} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} fontSize={11} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="count" fill="#5B5BF0" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div> : <p className="mt-3 text-sm text-muted">No assistant requests yet.</p>}</section>
          </div>
          <h3 className="mb-2 mt-6 text-sm font-semibold">Recent requests</h3>
          <div className="card overflow-x-auto"><table className="w-full min-w-[720px]"><thead><tr className="border-b border-line"><th className="th">When</th><th className="th">User</th><th className="th">Message (preview)</th><th className="th">Intent</th><th className="th">Mode</th><th className="th">Result</th></tr></thead>
            <tbody className="divide-y divide-line">{ai.data.recent.length ? ai.data.recent.map((r: any) => <tr key={r.id}><td className="td whitespace-nowrap">{date(r.at)}</td><td className="td">{r.user}</td><td className="td max-w-xs truncate">{r.message}</td><td className="td">{r.action || '–'}</td><td className="td">{r.mode}</td><td className="td">{r.ok ? <span className="badge bg-ok/10 text-ok">ok · {r.durationMs} ms</span> : <span className="badge bg-bad/10 text-bad" title={r.error}>failed</span>}</td></tr>) : <tr><td className="td text-muted" colSpan={6}>No requests yet.</td></tr>}</tbody></table></div>
          <p className="mt-2 text-xs text-muted">Only a 120-character preview is stored, and nothing is stored for users who turned AI memory off.</p>
        </>}
      </section>
      </>}
      {tab === 'catalog' && <>
      <section className="mt-6"><h2 className="mb-2 font-semibold">Catalog: price and stock</h2>
        {prods.loading ? <Spinner /> : <div className="card overflow-x-auto"><table className="w-full min-w-[620px]"><thead><tr className="border-b border-line"><th className="th">Product</th><th className="th">Price</th><th className="th">Set price</th><th className="th">Stock</th></tr></thead>
          <tbody className="divide-y divide-line">{prods.data?.items.map((p: any) => (
            <tr key={p.id}><td className="td">{p.name}</td><td className="td">{inr(p.price)}</td>
              <td className="td"><div className="flex gap-2"><input className="input !w-28 !py-1.5" type="number" min={1} value={edit[p.id] || ''} onChange={(e) => setEdit({ ...edit, [p.id]: e.target.value })} aria-label={`New price for ${p.name}`} /><button className="btn-ghost btn-sm" disabled={!edit[p.id]} onClick={() => setPrice(p.id)}>Update</button></div></td>
              <td className="td"><input className="input !w-20 !py-1.5" type="number" min={0} defaultValue={p.stock} onBlur={(e) => Number(e.target.value) !== p.stock && setStock(p.id, Number(e.target.value))} aria-label={`Stock for ${p.name}`} /></td></tr>))}</tbody></table></div>}</section>
      </>}
    </>
  );
}
