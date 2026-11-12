import { Link } from 'react-router-dom';
import { ArrowRight, Bot, Scale, ShieldCheck, Wallet, Search, Sparkles } from 'lucide-react';
import { useApp } from '../store';

const steps = [
  'You describe what you need', 'The Shopping Agent structures your request', 'The Research Agent searches the catalog', 'The Comparison Agent weighs specs and prices',
  'The Budget Agent checks affordability', 'Your cart is built and validated', 'You review and approve the order', 'PayPal Checkout takes the payment',
  'The server captures and verifies it', 'A signed webhook confirms the order',
];
const agents = [
  { icon: Sparkles, name: 'Shopping Agent', text: 'Extracts budget, use cases and brands, and asks only for what is missing.' },
  { icon: Search, name: 'Research Agent', text: 'Searches the product database with tools. Every id it returns is checked against the database.' },
  { icon: Scale, name: 'Comparison Agent', text: 'Builds a spec table, names the winner per row, and explains the trade-offs.' },
  { icon: Wallet, name: 'Budget Agent', text: 'Totals the cost, flags overspend, ranks value for money, and finds cheaper options.' },
  { icon: ShieldCheck, name: 'Payment Agent', text: 'Prepares the order. It cannot charge you: only your approval starts a PayPal payment.' },
];

export default function Landing() {
  const user = useApp((s) => s.user);
  return (
    <div className="min-h-screen bg-white">
      <section className="bg-navy-950 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <span className="flex items-center gap-2 font-display text-lg font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand"><Bot className="h-4 w-4" /></span>PayPilot AI</span>
          <div className="flex gap-3 text-sm font-semibold">
            {user ? <Link to="/dashboard" className="btn bg-white text-navy-900 hover:bg-white/90">Open dashboard</Link> : <>
              <Link to="/login" className="btn text-white/80 hover:text-white">Sign in</Link>
              <Link to="/register" className="btn bg-white text-navy-900 hover:bg-white/90">Create account</Link></>}
          </div>
        </div>
        <div className="mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <h1 className="text-4xl font-semibold leading-[1.1] sm:text-5xl">Tell the agents what you need. You approve what gets bought.</h1>
            <p className="mt-5 max-w-xl text-lg text-white/70">PayPilot AI researches products, compares them against your budget, builds the cart and prepares a PayPal checkout. Nothing is charged until you say so.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={user ? '/assistant' : '/register'} className="btn-brand">Start shopping with AI <ArrowRight className="h-4 w-4" /></Link>
              <Link to={user ? '/discover' : '/login'} className="btn border border-white/20 text-white hover:bg-white/10">Browse the catalog</Link>
            </div>
          </div>
          <ol className="rounded-2xl border border-white/10 bg-white/5 p-6">
            {steps.map((s, i) => (
              <li key={s} className="flex items-start gap-3 py-1.5 text-sm text-white/85">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand/80 text-[11px] font-bold">{i + 1}</span>{s}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-semibold">Five agents, each with its own tools</h2>
        <p className="mt-2 max-w-2xl text-muted">Agents call backend tools to read real catalog data. Their output is validated before anything runs.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map(({ icon: I, name, text }) => (
            <div key={name} className="rounded-2xl border border-line p-5">
              <I className="h-5 w-5 text-brand" />
              <h3 className="mt-3 font-semibold">{name}</h3>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </div>
          ))}
          <div className="rounded-2xl bg-navy-900 p-5 text-white">
            <h3 className="font-semibold">Payments you can verify</h3>
            <p className="mt-1 text-sm text-white/70">The server sets the amount, captures the payment, checks it against the order, and only then marks it paid. Webhook signatures are verified and processed once.</p>
          </div>
        </div>
      </section>
      <footer className="border-t border-line py-6 text-center text-xs text-muted">PayPilot AI runs on the PayPal Sandbox. No real money moves.<br />Built by Neha Gupta and Harsh Vardhan Maurya</footer>
    </div>
  );
}
