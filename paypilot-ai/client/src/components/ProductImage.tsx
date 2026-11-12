import { useEffect, useRef, useState } from 'react';
import { Headphones, Laptop, Monitor, Mouse, Smartphone } from 'lucide-react';

const icons: Record<string, any> = { laptops: Laptop, phones: Smartphone, audio: Headphones, monitors: Monitor, accessories: Mouse };
// Same rule the seed script uses to build a slug, so order/cart rows that only carry a name still resolve.
const slugify = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-');

type Img = { slug?: string; name: string; category?: string; image?: string };

/**
 * Product picture with a shimmer while loading and a 3-step fallback:
 * 1) the product's own illustration  2) the category illustration  3) a category icon.
 * The container always keeps its aspect ratio, so layouts never jump and are never empty.
 * Assets are local (public/products), so they do not depend on third-party hosts.
 */
export function ProductImage({ p, className = '', ratio = 'aspect-[400/260]' }: { p: Img; className?: string; ratio?: string; pad?: string }) {
  const own = p.image || `/products/${p.slug || slugify(p.name)}.svg`;
  const cat = `/products/_${p.category || 'laptops'}.svg`;
  const [src, setSrc] = useState(own);
  const [loaded, setLoaded] = useState(false);
  const [dead, setDead] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => { setSrc(own); setLoaded(false); setDead(false); }, [own]);
  // A cached image can finish loading before React attaches onLoad, so also check on mount / src change.
  useEffect(() => { const el = ref.current; if (el && el.complete && el.naturalWidth > 0) setLoaded(true); }, [src]);
  const Fallback = icons[p.category || ''] || Laptop;
  return (
    <div className={`relative w-full overflow-hidden bg-gradient-to-br from-paper to-brand-soft ${ratio} ${className}`}>
      {!loaded && !dead && <div className="skeleton absolute inset-0 rounded-none" aria-hidden />}
      {dead ? (
        <div className="grid h-full w-full place-items-center text-brand/60" role="img" aria-label={p.name}><Fallback className="h-1/3 w-1/3" strokeWidth={1.25} /></div>
      ) : (
        <img ref={ref} src={src} alt={p.name} decoding="async" draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => { if (src !== cat) setSrc(cat); else setDead(true); }}
          className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`} />
      )}
    </div>
  );
}

export const CategoryIcon = ({ category, className = 'h-5 w-5' }: { category: string; className?: string }) => {
  const I = icons[category] || Laptop;
  return <I className={className} />;
};
