import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Bot, CheckCircle2, CreditCard, Heart, Info, LayoutDashboard, LogOut, Menu, Package, Scale, Search, Settings, ShieldCheck, ShoppingCart, Sparkles, TrendingDown, UserCircle, X, XCircle, type LucideIcon } from 'lucide-react';
import { useApp } from '../store';

type NavItem = { to: string; label: string; icon: LucideIcon; badge?: 'cart' | 'unread' };
const nav: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/assistant', label: 'AI assistant', icon: Sparkles },
  { to: '/discover', label: 'Discover', icon: Search },
  { to: '/compare', label: 'Compare', icon: Scale },
  { to: '/cart', label: 'Cart', icon: ShoppingCart, badge: 'cart' },
  { to: '/orders', label: 'Orders', icon: Package },
  { to: '/transactions', label: 'Transactions', icon: CreditCard },
  { to: '/wishlist', label: 'Wishlist', icon: Heart },
  { to: '/watch', label: 'Price watch', icon: TrendingDown },
  { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'unread' },
  { to: '/profile', label: 'Profile & memory', icon: UserCircle },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const Logo = () => (
  <div className="flex items-center gap-2.5 px-5 py-5">
    <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white shadow-lg shadow-brand/30"><Bot className="h-5 w-5" /></span>
    <span className="font-display text-lg font-semibold leading-none text-white">PayPilot <span className="text-brand-soft/90">AI</span></span>
  </div>
);

export default function Layout() {
  const { user, cartCount, unread, logout, refresh, toasts, compare } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => { setOpen(false); refresh(); }, [loc.pathname, refresh]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', k); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [open]);
  const items: NavItem[] = user?.role === 'admin' ? [...nav, { to: '/admin', label: 'Admin', icon: ShieldCheck }] : nav;
  const counts = { cart: cartCount, unread };
  const initials = (user?.name || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();

  const side = (
    <nav className="flex h-full flex-col bg-navy-950 text-slate-300" aria-label="Main">
      <Logo />
      <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {items.map(({ to, label, icon: I, badge }) => {
          const n = badge ? counts[badge] : to === '/compare' ? compare.length : 0;
          return (
            <NavLink key={to} to={to} aria-label={n > 0 ? `${label}, ${n}` : label}
              className={({ isActive }) => `group relative flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-brand ${isActive ? 'bg-brand text-white shadow-md shadow-brand/20' : 'hover:bg-white/[.07] hover:text-white'}`}>
              <I className="h-[18px] w-[18px] shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
              {n > 0 && <span className={`ml-auto grid h-5 min-w-[20px] place-items-center rounded-full px-1.5 text-[11px] font-bold leading-none ${badge ? 'bg-brand text-white group-aria-[current=page]:bg-white group-aria-[current=page]:text-brand' : 'bg-white/15 text-white'}`}>{n > 99 ? '99+' : n}</span>}
            </NavLink>
          );
        })}
      </div>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white" aria-hidden>{initials}</span>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-white">{user?.name}</div><div className="truncate text-xs text-slate-400">{user?.email}</div></div>
          <button className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out" onClick={async () => { await logout(); navigate('/'); }}><LogOut className="h-[18px] w-[18px]" /></button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">{side}</aside>
      <header className="sticky top-0 z-30 flex items-center justify-between bg-navy-950 px-4 py-2.5 text-white lg:hidden">
        <span className="flex items-center gap-2 font-display font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand"><Bot className="h-4 w-4" /></span>PayPilot AI</span>
        <div className="flex items-center gap-1">
          <NavLink to="/cart" className="relative grid h-10 w-10 place-items-center rounded-lg hover:bg-white/10" aria-label={`Cart, ${cartCount} items`}><ShoppingCart className="h-5 w-5" />{cartCount > 0 && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-brand px-1 text-[10px] font-bold">{cartCount}</span>}</NavLink>
          <button className="grid h-10 w-10 place-items-center rounded-lg hover:bg-white/10" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}><Menu className="h-5 w-5" /></button>
        </div>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative h-full w-72 max-w-[85vw]">{side}<button className="absolute right-3 top-5 grid h-9 w-9 place-items-center rounded-lg text-white hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button></div>
        </div>
      )}
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-8 sm:py-8"><div className="mx-auto max-w-6xl">
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900" role="note">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><b>Demo data.</b> The catalog is a seeded sample with fictional brands and illustrated product images. Prices, specs and stock are not live market data. Payments use the PayPal <b>Sandbox</b>, so no real money moves.</span>
        </div>
        <Outlet />
        <footer className="mt-10 border-t border-line py-4 text-center text-xs text-muted">Built by Neha Gupta and Harsh Vardhan Maurya</footer></div></main>
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${t.tone === 'ok' ? 'bg-navy-900' : 'bg-bad'}`}>
            {t.tone === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" /> : <XCircle className="h-4 w-4 shrink-0" />}{t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
