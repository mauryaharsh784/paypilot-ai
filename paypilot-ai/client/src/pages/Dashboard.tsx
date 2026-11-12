import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Bot, CheckCircle2, ChevronRight, Heart, Package, Receipt, ShoppingBag, ShoppingCart, Sparkles, TrendingDown, Wallet } from 'lucide-react';
import { useFetch } from '../lib/api';
import { date, inr, short, statusLabel } from '../lib/format';
import { Empty, ErrorState, Spinner, Status } from '../components/ui';
import { ProductImage } from '../components/ProductImage';
import { useApp } from '../store';

const basisText: Record<string, string> = { preferences: 'Based on your saved preferences', activity: 'Based on your wishlist and purchases', top_rated: 'Top rated in the demo catalog. Save preferences to personalise this.' };
const activityIcon: Record<string, any> = { order: Package, ai: Bot, wishlist: Heart, watch: TrendingDown };
const txColor: Record<string, string> = { completed: '#12A150', pending: '#B86E00', failed: '#D64545', cancelled: '#94A3B8', refunded: '#94A3B8' };

export default function Dashboard() {
  const { data, loading, error, reload } = useFetch<any>('/dashboard');
  const user = useApp((s) => s.user);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState message={error || 'Could not load the dashboard'} retry={reload} />;
  const s = data.stats, b = data.budget;
  const obs: Record<string, number> = s.ordersByStatus || {};
  const open = (obs.awaiting_approval || 0) + (obs.awaiting_payment || 0);
  const cards = [
    { label: 'Paid orders', value: s.paidOrders, sub: `${s.orders} created in total`, icon: Package, to: '/orders', tone: 'bg-brand-soft text-brand' },
    { label: 'Items purchased', value: s.totalPurchases, sub: 'From verified payments', icon: ShoppingBag, to: '/orders', tone: 'bg-sky-50 text-sky-600' },
    { label: 'Total spent', value: inr(s.spent), sub: 'Verified payments only', icon: Wallet, to: '/transactions', tone: 'bg-amber-50 text-amber-600' },
    { label: 'Verified transactions', value: s.successfulTransactions, sub: 'Confirmed by the server', icon: CheckCircle2, to: '/transactions', tone: 'bg-emerald-50 text-emerald-600' },
    { label: 'In your cart', value: s.cartItems, sub: inr(s.cartTotal), icon: ShoppingCart, to: '/cart', tone: 'bg-rose-50 text-rose-600' },
  ];
  const used = b.cartBudget ? Math.min(100, Math.round((b.cartTotal / b.cartBudget) * 100)) : 0;
  const over = b.cartBudget && b.cartRemaining < 0;
  const orderBreakdown = [['paid', obs.paid || 0], ['awaiting_payment', open], ['cancelled', obs.cancelled || 0], ['failed', obs.failed || 0]] as const;
  return (
    <>
      <section className="relative overflow-hidden rounded-2xl bg-navy-900 px-6 py-6 text-white shadow-card sm:px-8 sm:py-7">
        <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-brand/25 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div className="min-w-0">
            <p className="text-sm text-white/60">Welcome back</p>
            <h1 className="mt-0.5 text-2xl font-semibold sm:text-3xl">Hello, {user?.name.split(' ')[0]}</h1>
            <p className="mt-2 max-w-xl text-sm text-white/70">{s.cartItems > 0 ? `You have ${s.cartItems} item${s.cartItems > 1 ? 's' : ''} in your cart worth ${inr(s.cartTotal)}.` : 'Your cart is empty. Ask the assistant to shortlist something for you.'} Everything here is calculated from your own orders and activity.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/assistant" className="btn-primary"><Sparkles className="h-4 w-4" />Ask the AI assistant</Link>
            <Link to={s.cartItems > 0 ? '/cart' : '/discover'} className="btn border border-white/20 text-white hover:bg-white/10">{s.cartItems > 0 ? <><ShoppingCart className="h-4 w-4" />View cart</> : <>Browse products</>}</Link>
          </div>
        </div>
      </section>
      <div className="mt-5" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {cards.map(({ label, value, sub, icon: I, to, tone }, i) => (
          <Link key={label} to={to} className={`card flex flex-col gap-3 p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${i === 4 ? 'col-span-2 lg:col-span-1' : ''}`}>
            <span className={`grid h-9 w-9 place-items-center rounded-xl ${tone}`}><I className="h-[18px] w-[18px]" /></span>
            <div><div className="text-xs font-medium text-muted">{label}</div><div className="mt-0.5 font-display text-xl font-semibold leading-tight">{value}</div><div className="mt-0.5 text-xs text-muted">{sub}</div></div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="card card-pad">
          <div className="flex items-start justify-between gap-3"><div><h2 className="section-title">Spending by month</h2><p className="mt-0.5 text-xs text-muted">Counts only orders PayPal captured and the server verified.</p></div></div>
          {data.spendByMonth.length ? (
            <div className="mt-4 h-60" role="img" aria-label="Bar chart of spending by month">
              <ResponsiveContainer><BarChart data={data.spendByMonth}><CartesianGrid vertical={false} stroke="#E2E7F1" /><XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} /><YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => `₹${v >= 1000 ? v / 1000 + 'k' : v}`} /><Tooltip formatter={(v: any) => inr(v)} cursor={{ fill: '#ECECFE' }} /><Bar dataKey="total" name="Spent" fill="#5B5BF0" radius={[6, 6, 0, 0]} maxBarSize={56} /></BarChart></ResponsiveContainer>
            </div>
          ) : <div className="mt-4 rounded-xl bg-paper px-4 py-10 text-center text-sm text-muted">The chart appears after your first verified payment.</div>}
        </section>
        <section className="card card-pad">
          <h2 className="section-title">Budget overview</h2>
          {b.cartBudget ? (
            <div className="mt-4">
              <div className="flex items-end justify-between"><div><div className="text-xs text-muted">Cart total</div><div className="font-display text-2xl font-semibold">{inr(b.cartTotal)}</div></div><div className="text-right text-xs text-muted">of {inr(b.cartBudget)} budget</div></div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-line" role="img" aria-label={`${used}% of cart budget used`}><div className={`h-full rounded-full transition-all ${over ? 'bg-bad' : used > 85 ? 'bg-warn' : 'bg-brand'}`} style={{ width: `${used}%` }} /></div>
              <div className={`mt-2 text-sm font-semibold ${over ? 'text-bad' : 'text-ok'}`}>{over ? `${inr(Math.abs(b.cartRemaining))} over budget` : `${inr(b.cartRemaining)} remaining`}</div>
            </div>
          ) : <p className="mt-3 rounded-xl bg-paper p-3 text-sm text-muted">No cart budget set. <Link to="/cart" className="font-semibold text-brand">Set one in your cart</Link> to track it here.</p>}
          <dl className="mt-4 space-y-2.5 border-t border-line pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Saved max budget</dt><dd className="font-semibold">{b.preferredMaxBudget ? inr(b.preferredMaxBudget) : 'Not set'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Average paid order</dt><dd className="font-semibold">{b.averageOrderValue ? inr(b.averageOrderValue) : '–'}</dd></div>
          </dl>
        </section>
      </div>

      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="section-title"><Sparkles className="h-4 w-4 text-brand" />Recommended for you</h2><p className="mt-0.5 text-xs text-muted">{basisText[data.recommendations.basis]}</p></div><Link to="/discover" className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold text-brand hover:underline">Browse all<ChevronRight className="h-4 w-4" /></Link></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.recommendations.items.map((p: any) => (
            <Link key={p.id} to={`/product/${p.id}`} className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-lg">
              <ProductImage p={p} />
              <div className="flex flex-1 flex-col gap-1 p-4">
                <div className="text-xs text-muted">{p.brand}</div>
                <div className="line-clamp-2 font-semibold leading-snug group-hover:text-brand">{p.name}</div>
                <div className="font-display font-semibold">{inr(p.price)}</div>
                <ul className="mt-1 space-y-0.5 text-xs text-muted">{p.reasons.slice(0, 2).map((r: string) => <li key={r} className="flex gap-1.5"><span className="text-brand">•</span>{r}</li>)}</ul>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card card-pad">
          <h2 className="section-title">Orders and transactions</h2>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {orderBreakdown.map(([k, n]) => (
              <div key={k} className="rounded-xl bg-paper p-3"><div className="font-display text-xl font-semibold">{n}</div><div className="mt-1"><Status s={k} /></div></div>
            ))}
          </div>
          <h3 className="mt-5 text-sm font-semibold">Transactions by status</h3>
          {data.transactionsByStatus.length ? (
            <div className="mt-2 h-40" role="img" aria-label="Bar chart of transactions by status">
              <ResponsiveContainer><BarChart data={data.transactionsByStatus.map((x: any) => ({ ...x, label: statusLabel[x.status] || x.status }))}><CartesianGrid vertical={false} stroke="#E2E7F1" /><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={28} /><Tooltip cursor={{ fill: '#F5F7FB' }} /><Bar dataKey="count" name="Transactions" radius={[6, 6, 0, 0]} maxBarSize={56} fill="#12A150" shape={(p: any) => <rect {...p} fill={txColor[p.status] || '#94A3B8'} rx={6} />} /></BarChart></ResponsiveContainer>
            </div>
          ) : <p className="mt-2 rounded-xl bg-paper px-4 py-6 text-center text-sm text-muted">No transactions yet. They appear after your first PayPal checkout.</p>}
          <Link to="/transactions" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"><Receipt className="h-3.5 w-3.5" />All transactions</Link>
        </section>
        <section className="card card-pad">
          <h2 className="section-title">Shopping activity</h2>
          {data.activity.length ? (
            <ul className="mt-3 divide-y divide-line">
              {data.activity.map((a: any, i: number) => { const I = activityIcon[a.type] || Package; return (
                <li key={i}><Link to={a.link || '#'} className="flex items-start gap-3 py-2.5 text-sm hover:text-brand"><span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-paper text-muted"><I className="h-3.5 w-3.5" /></span><span className="min-w-0 flex-1">{a.text}</span><span className="hidden shrink-0 text-xs text-muted sm:block">{date(a.at)}</span></Link></li>); })}
            </ul>
          ) : <p className="mt-3 rounded-xl bg-paper px-4 py-10 text-center text-sm text-muted">Your searches, saves and orders will show up here.</p>}
        </section>
      </div>

      <section className="card card-pad mt-6">
        <h2 className="section-title">Recent orders</h2>
        {data.recentOrders.length ? (
          <ul className="mt-3 divide-y divide-line">
            {data.recentOrders.map((o: any) => (
              <li key={o._id}><Link to={`/orders/${o._id}`} className="flex items-center justify-between gap-3 py-3 text-sm hover:text-brand">
                <span><span className="font-semibold">#{short(o._id)}</span><span className="block text-xs text-muted">{date(o.createdAt)}</span></span>
                <span className="flex items-center gap-3"><span className="font-semibold">{inr(o.total)}</span><Status s={o.status} /></span></Link></li>
            ))}
          </ul>
        ) : <div className="mt-4"><Empty title="No orders yet" hint="Ask the assistant to find something and it will build your first cart." icon={Package} /></div>}
      </section>
    </>
  );
}
