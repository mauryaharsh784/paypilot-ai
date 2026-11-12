import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Heart, Loader2, Scale, ShoppingCart, Star } from 'lucide-react';
import { api } from '../lib/api';
import { discountPct, inr } from '../lib/format';
import { useApp } from '../store';
import { ProductImage } from './ProductImage';

export { CategoryIcon } from './ProductImage';

export function ProductCard({ p, children, footer }: { p: any; children?: React.ReactNode; footer?: React.ReactNode }) {
  const { toast, refresh, compare, toggleCompare } = useApp();
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);
  const add = async () => {
    setAdding(true);
    try { const r = await api('/cart/items', { method: 'POST', body: { productId: p.id, quantity: 1 } }); toast(r.message); refresh(); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setAdding(false); }
  };
  const wish = async () => {
    try { await api(`/wishlist/${p.id}`, { method: 'POST', body: {} }); setSaved(true); toast('Saved to your wishlist'); }
    catch (e: any) { toast(e.message, 'bad'); }
  };
  const off = discountPct(p.price, p.mrp);
  const inCompare = compare.includes(p.id);
  const out = p.stock != null && p.stock < 1;
  return (
    <article className="card group flex flex-col overflow-hidden transition-shadow duration-200 hover:shadow-lg">
      <Link to={`/product/${p.id}`} className="relative block" aria-label={`View ${p.name}`}>
        <ProductImage p={p} className="transition-transform duration-300 group-hover:scale-[1.02]" />
        {off > 0 && <span className="badge absolute left-3 top-3 bg-ok text-white">{off}% off</span>}
        {out && <span className="badge absolute right-3 top-3 bg-slate-800 text-white">Out of stock</span>}
        {!out && p.stock <= 3 && p.stock != null && <span className="badge absolute right-3 top-3 bg-amber-100 text-warn">Only {p.stock} left</span>}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2 text-xs text-muted"><span className="truncate">{p.brand}</span><span className="capitalize">{p.category}</span></div>
        <Link to={`/product/${p.id}`} className="line-clamp-2 min-h-[2.6rem] font-display font-semibold leading-snug hover:text-brand">{p.name}</Link>
        <div className="flex items-center gap-1.5 text-xs text-muted"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /><span className="font-semibold text-ink">{p.rating}</span>({p.reviews.toLocaleString('en-IN')})</div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-lg font-semibold">{inr(p.price)}</span>
          {off > 0 && <span className="text-xs text-muted line-through">{inr(p.mrp)}</span>}
        </div>
        {children}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <button className="btn-primary btn-sm flex-1" onClick={add} disabled={adding || out}>
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}{out ? 'Unavailable' : 'Add to cart'}
          </button>
          <button className={`btn-icon ${saved ? 'btn-icon-on' : ''}`} onClick={wish} aria-label={saved ? 'Saved to wishlist' : 'Save to wishlist'} title="Save to wishlist">
            {saved ? <Check className="h-4 w-4" /> : <Heart className="h-4 w-4" />}
          </button>
          <button className={`btn-icon ${inCompare ? 'btn-icon-on' : ''}`} onClick={() => toggleCompare(p.id)} aria-pressed={inCompare} aria-label={inCompare ? 'Remove from compare' : 'Add to compare'} title={inCompare ? 'Remove from compare' : 'Add to compare'}>
            <Scale className="h-4 w-4" />
          </button>
        </div>
        {footer}
      </div>
    </article>
  );
}
