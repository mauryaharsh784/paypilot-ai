import { Types } from 'mongoose';
import { Product, Cart, Order, Transaction, PricePoint, User, Wishlist } from './models';
import { computeTotals } from './pricing';
import { AppError, esc, inr } from './http';

export const CATEGORIES = ['laptops', 'phones', 'audio', 'monitors', 'accessories'];

export const SPEC_META: Record<string, { label: string; unit?: string; better: 'higher' | 'lower' | 'none' }> = {
  perf: { label: 'Performance index', better: 'higher' },
  ram_gb: { label: 'RAM', unit: 'GB', better: 'higher' },
  storage_gb: { label: 'Storage', unit: 'GB', better: 'higher' },
  battery_hours: { label: 'Battery life', unit: 'h', better: 'higher' },
  battery_mah: { label: 'Battery', unit: 'mAh', better: 'higher' },
  camera_mp: { label: 'Main camera', unit: 'MP', better: 'higher' },
  refresh_hz: { label: 'Refresh rate', unit: 'Hz', better: 'higher' },
  weight_kg: { label: 'Weight', unit: 'kg', better: 'lower' },
  display_in: { label: 'Display', unit: 'in', better: 'none' },
  cpu: { label: 'Processor', better: 'none' },
  gpu: { label: 'Graphics', better: 'none' },
  resolution: { label: 'Resolution', better: 'none' },
  connectivity: { label: 'Connectivity', better: 'none' },
  anc: { label: 'Noise cancelling', better: 'none' },
};

const SYN: Record<string, string> = {
  coding: 'programming', code: 'programming', dev: 'programming', developer: 'programming', development: 'programming', programming: 'programming',
  multitask: 'multitasking', multitasking: 'multitasking', 'multi-tasking': 'multitasking',
  game: 'gaming', games: 'gaming', gamer: 'gaming', gaming: 'gaming',
  study: 'student', college: 'student', school: 'student', student: 'student',
  travel: 'travel', portable: 'portable', light: 'portable', lightweight: 'portable',
  battery: 'battery', camera: 'camera', photo: 'camera', photos: 'camera', photography: 'camera',
  music: 'audio', audio: 'audio', calls: 'calls', call: 'calls', anc: 'noise-cancelling', noise: 'noise-cancelling', 'noise-cancelling': 'noise-cancelling',
  wireless: 'wireless', office: 'work', work: 'work', editing: 'creative', design: 'creative', video: 'creative', creative: 'creative',
  budget: 'budget', cheap: 'budget', premium: 'premium', fitness: 'fitness', gym: 'fitness', running: 'fitness',
};
export const normalizeTokens = (s: string) =>
  Array.from(new Set(s.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean).map((w) => SYN[w] || w)));

export const pub = (p: any) => ({
  id: String(p._id), slug: p.slug, name: p.name, brand: p.brand, category: p.category,
  price: p.price, mrp: p.mrp, rating: p.rating, reviews: p.reviews, stock: p.stock,
  tags: p.tags, specs: p.specs, description: p.description, image: p.image,
});

export async function getProduct(id: string) {
  if (!Types.ObjectId.isValid(id)) return { error: 'Invalid product id' };
  const p = await Product.findOne({ _id: id, active: true }).lean();
  return p ? pub(p) : { error: 'Product not found' };
}

type SearchArgs = {
  query?: string; category?: string | null; maxPrice?: number | null; minPrice?: number | null;
  brands?: string[]; useCases?: string[]; mustHave?: string[]; limit?: number;
};

export async function searchProducts(a: SearchArgs) {
  const filter: any = { active: true, stock: { $gt: 0 } };
  if (a.category) filter.category = new RegExp(`^${esc(a.category)}$`, 'i');
  const all = await Product.find(filter).lean();
  const vocab = new Set(all.flatMap((p: any) => p.tags));
  const tokens = normalizeTokens([a.query, ...(a.useCases || []), ...(a.mustHave || [])].filter(Boolean).join(' '));
  const wanted = tokens.filter((t) => vocab.has(t));
  const brands = (a.brands || []).map((b) => b.toLowerCase());

  const scored = all.map((p: any) => {
    const hay = `${p.name} ${p.description}`.toLowerCase();
    const hits = wanted.filter((t) => p.tags.includes(t));
    let s = hits.length * 3 + (p.rating || 0) * 0.4;
    for (const t of tokens) if (!wanted.includes(t) && t.length > 2 && hay.includes(t)) s += 1;
    if (brands.includes(String(p.brand).toLowerCase())) s += 2;
    return { p, s, hits };
  });

  let within = scored.filter((x) => (!a.maxPrice || x.p.price <= a.maxPrice) && (!a.minPrice || x.p.price >= a.minPrice));
  if (wanted.length) {
    const fit = within.filter((x) => x.hits.length > 0);
    if (fit.length) within = fit;
  }
  within.sort((x, y) => y.s - x.s);
  const near = a.maxPrice
    ? scored.filter((x) => x.p.price > a.maxPrice! && x.p.price <= a.maxPrice! * 1.15 && (!wanted.length || x.hits.length))
        .sort((x, y) => y.s - x.s).slice(0, 2)
    : [];
  const limit = Math.min(a.limit || 6, 8);
  return {
    results: within.slice(0, limit).map((x) => ({ ...pub(x.p), relevance: +x.s.toFixed(1), matchedTags: x.hits })),
    nearMisses: near.map((x) => pub(x.p)),
    totalMatched: within.length,
  };
}

export async function compareProducts(ids: string[]) {
  const valid = ids.filter((i) => Types.ObjectId.isValid(i)).slice(0, 4);
  const found = await Product.find({ _id: { $in: valid }, active: true }).lean();
  const products = valid.map((i) => found.find((p: any) => String(p._id) === i)).filter(Boolean).map(pub);
  const rows: any[] = [];
  const addRow = (key: string, label: string, unit: string | undefined, better: string, get: (p: any) => any) => {
    const values: Record<string, any> = {};
    products.forEach((p) => { values[p.id] = get(p) ?? null; });
    const nums = products.map((p) => values[p.id]).filter((v) => typeof v === 'number') as number[];
    let bestId: string | null = null, worstId: string | null = null;
    if (better !== 'none' && nums.length > 1 && new Set(nums).size > 1) {
      const best = better === 'higher' ? Math.max(...nums) : Math.min(...nums);
      const worst = better === 'higher' ? Math.min(...nums) : Math.max(...nums);
      bestId = products.find((p) => values[p.id] === best)!.id;
      worstId = products.find((p) => values[p.id] === worst)!.id;
    }
    rows.push({ key, label, unit, values, bestId, worstId, better });
  };
  addRow('price', 'Price', '₹', 'lower', (p) => p.price);
  addRow('rating', 'Rating', '/5', 'higher', (p) => p.rating);
  const keys = Array.from(new Set(products.flatMap((p) => Object.keys(p.specs || {}))));
  for (const k of keys) {
    const m = SPEC_META[k] || { label: k.replace(/_/g, ' '), better: 'none' as const };
    addRow(k, m.label, m.unit, m.better, (p) => p.specs?.[k]);
  }
  const perProduct: Record<string, { pros: string[]; cons: string[] }> = {};
  products.forEach((p) => { perProduct[p.id] = { pros: [], cons: [] }; });
  for (const r of rows) {
    if (r.bestId) {
      const v = r.values[r.bestId];
      perProduct[r.bestId].pros.push(r.key === 'price' ? 'Lowest price' : `Best ${r.label.toLowerCase()} (${v}${r.unit && r.unit !== '₹' && r.unit !== '/5' ? ' ' + r.unit : ''})`);
    }
    if (r.worstId) perProduct[r.worstId].cons.push(r.key === 'price' ? 'Highest price' : `Lowest ${r.label.toLowerCase()}`);
  }
  for (const k of Object.keys(perProduct)) {
    perProduct[k].pros = perProduct[k].pros.slice(0, 4);
    perProduct[k].cons = perProduct[k].cons.slice(0, 3);
  }
  return { products, rows, perProduct };
}

const valueRaw = (p: any) => ((p.specs?.perf ?? p.rating * 20) + p.rating * 10) / p.price;

export async function analyzeBudget(ids: string[], budget?: number | null, quantities: Record<string, number> = {}) {
  const valid = ids.filter((i) => Types.ObjectId.isValid(i));
  const found = await Product.find({ _id: { $in: valid } }).lean();
  const items = valid.map((i) => found.find((p: any) => String(p._id) === i)).filter(Boolean) as any[];
  const maxRaw = Math.max(...items.map(valueRaw), 0.0001);
  const ranking = items
    .map((p) => ({ id: String(p._id), name: p.name, price: p.price, valueScore: Math.round((valueRaw(p) / maxRaw) * 100) }))
    .sort((a, b) => b.valueScore - a.valueScore);
  const perItem = items.map((p) => {
    const t = computeTotals([{ price: p.price, quantity: quantities[String(p._id)] || 1 }]);
    return {
      id: String(p._id), name: p.name, price: p.price, shipping: t.shipping, total: t.total,
      utilizationPct: budget ? Math.round((t.total / budget) * 100) : null,
      remaining: budget ? budget - t.total : null,
      overBudget: budget ? t.total > budget : false,
    };
  });
  const warnings: string[] = [];
  if (!budget) warnings.push('No maximum budget set, so affordability cannot be checked.');
  perItem.forEach((i) => {
    if (i.overBudget) warnings.push(`${i.name} is ${inr(i.total - budget!)} over your budget.`);
    else if (i.utilizationPct && i.utilizationPct >= 90) warnings.push(`${i.name} uses ${i.utilizationPct}% of your budget, leaving little room for accessories.`);
    if (i.shipping > 0) warnings.push(`${i.name} adds ${inr(i.shipping)} shipping (free above ₹1,000).`);
  });
  items.filter((p) => p.stock > 0 && p.stock <= 3).forEach((p) => warnings.push(`Only ${p.stock} left of ${p.name}.`));

  let cheaper: any[] = [];
  if (items[0]) {
    const top = items[0];
    const pool = await Product.find({ category: top.category, active: true, stock: { $gt: 0 }, price: { $lt: top.price * 0.9 }, _id: { $nin: valid } }).lean();
    cheaper = pool
      .filter((p: any) => p.rating >= top.rating - 0.4)
      .sort((a: any, b: any) => valueRaw(b) - valueRaw(a))
      .slice(0, 2)
      .map((p: any) => ({ ...pub(p), saves: top.price - p.price }));
  }
  return { budget: budget || null, perItem, warnings, valueRanking: ranking, cheaperAlternatives: cheaper };
}

/* ---------- cart ---------- */
export async function getCartSummary(userId: string) {
  const cart = await Cart.findOne({ userId }).lean();
  const ids = (cart?.items || []).map((i: any) => i.productId);
  const prods = await Product.find({ _id: { $in: ids } }).lean();
  const items = (cart?.items || []).map((i: any) => {
    const p: any = prods.find((x: any) => String(x._id) === String(i.productId));
    if (!p) return null;
    return {
      productId: String(p._id), slug: p.slug, image: p.image, name: p.name, brand: p.brand, category: p.category, price: p.price,
      quantity: i.quantity, lineTotal: p.price * i.quantity, stock: p.stock, available: p.active && p.stock > 0,
    };
  }).filter(Boolean) as any[];
  const totals = computeTotals(items);
  const budget = cart?.budget ?? null;
  const warnings: string[] = [];
  if (budget && totals.total > budget) warnings.push(`Cart total is ${inr(totals.total - budget)} over your ${inr(budget)} budget.`);
  items.forEach((i) => { if (i.quantity > i.stock) warnings.push(`${i.name}: only ${i.stock} in stock.`); });
  return {
    items, itemCount: items.reduce((s, i) => s + i.quantity, 0), ...totals,
    budget, budgetRemaining: budget ? budget - totals.total : null, warnings,
  };
}

export async function cartAdd(userId: string, productId: string, quantity = 1, enforceBudget = false) {
  const p: any = Types.ObjectId.isValid(productId) ? await Product.findOne({ _id: productId, active: true }).lean() : null;
  if (!p) throw new AppError(404, 'Product not found', 'NOT_FOUND');
  if (p.stock < 1) throw new AppError(409, `${p.name} is out of stock`, 'OUT_OF_STOCK');
  const cart = (await Cart.findOne({ userId })) || new Cart({ userId, items: [] });
  const existing = cart.items.find((i: any) => String(i.productId) === productId);
  const next = Math.min((existing?.quantity || 0) + quantity, 10, p.stock);
  const before = await getCartSummary(userId);
  const projected = before.subtotal - (existing ? existing.quantity * p.price : 0) + next * p.price;
  if (enforceBudget && cart.budget && projected + (projected >= 1000 ? 0 : 99) > cart.budget) {
    return { ok: false, reason: 'BUDGET_EXCEEDED', message: `Adding ${p.name} would exceed your ${inr(cart.budget)} cart budget.`, cart: before };
  }
  if (existing) existing.quantity = next; else cart.items.push({ productId: p._id, quantity: next } as any);
  await cart.save();
  return {
    ok: true, duplicate: !!existing,
    message: existing ? `${p.name} was already in your cart, so I raised the quantity to ${next} instead of adding a duplicate line.` : `Added ${p.name} to your cart.`,
    cart: await getCartSummary(userId),
  };
}

export async function cartSetQuantity(userId: string, productId: string, quantity: number) {
  const cart = await Cart.findOne({ userId });
  const line = cart?.items.find((i: any) => String(i.productId) === productId);
  if (!cart || !line) throw new AppError(404, 'That product is not in your cart', 'NOT_IN_CART');
  if (quantity <= 0) cart.items = cart.items.filter((i: any) => String(i.productId) !== productId) as any;
  else {
    const p: any = await Product.findById(productId).lean();
    if (!p) throw new AppError(404, 'Product not found');
    if (quantity > p.stock) throw new AppError(409, `Only ${p.stock} of ${p.name} in stock`, 'OUT_OF_STOCK');
    line.quantity = Math.min(quantity, 10);
  }
  await cart.save();
  return { ok: true, cart: await getCartSummary(userId) };
}

export async function getMyOrders(userId: string) {
  const orders = await Order.find({ userId }).sort({ createdAt: -1 }).limit(5).lean();
  const txs = await Transaction.find({ orderId: { $in: orders.map((o: any) => o._id) } }).sort({ createdAt: -1 }).lean();
  return orders.map((o: any) => ({
    orderId: String(o._id), status: o.status, totalInr: o.total, charged: o.chargeAmount ? `${o.chargeAmount} ${o.chargeCurrency}` : null,
    items: o.items.map((i: any) => `${i.quantity} x ${i.name}`), paidAt: o.paidAt, failureReason: o.failureReason,
    transactions: txs.filter((t: any) => String(t.orderId) === String(o._id)).map((t: any) => ({ kind: t.kind, status: t.status, at: t.createdAt })),
  }));
}

export async function priceHistory(productId: string) {
  return PricePoint.find({ productId }).sort({ at: 1 }).lean();
}

/**
 * Recommendations built only from real records: saved preferences, wishlist, past paid orders and catalog data.
 * Every item carries the reasons it was picked; nothing is generated by a model.
 */
export async function recommendProducts(userId: string, limit = 6) {
  const [user, cart, wl, paid] = await Promise.all([
    User.findById(userId).lean() as any,
    Cart.findOne({ userId }).lean() as any,
    Wishlist.find({ userId }).lean() as any,
    Order.find({ userId, status: 'paid' }).lean() as any,
  ]);
  const prefs = user?.preferences || {};
  const owned = new Set<string>(paid.flatMap((o: any) => o.items.map((i: any) => String(i.productId))));
  const inCart = new Set<string>((cart?.items || []).map((i: any) => String(i.productId)));
  const wished = new Set<string>(wl.map((w: any) => String(w.productId)));

  // Categories and brands implied by what the user already bought or saved.
  const known = await Product.find({ _id: { $in: [...owned, ...wished] } }).lean() as any[];
  const histCats = new Set<string>(known.map((p) => p.category));
  const histBrands = new Set<string>(known.map((p) => p.brand));
  const wantCats = new Set<string>([...(prefs.categories || []), ...histCats]);
  const wantBrands = new Set<string>([...(prefs.brands || []), ...histBrands]);
  const specWords = (prefs.specs || []).map((x: string) => x.toLowerCase());

  const filter: any = { active: true, stock: { $gt: 0 }, _id: { $nin: [...owned, ...inCart].filter((x) => Types.ObjectId.isValid(x)) } };
  if (prefs.maxBudget) filter.price = { $lte: prefs.maxBudget };
  const pool = await Product.find(filter).lean() as any[];

  const scored = pool.map((p) => {
    const reasons: string[] = [];
    let score = (p.rating || 0) * 10;
    if (wantCats.has(p.category)) { score += 20; reasons.push(prefs.categories?.includes(p.category) ? `In your preferred category (${p.category})` : `You showed interest in ${p.category}`); }
    if (wantBrands.has(p.brand)) { score += 12; reasons.push(`From ${p.brand}, a brand you chose or saved`); }
    if (specWords.some((w: string) => (p.tags || []).some((t: string) => t.toLowerCase().includes(w)) || p.description?.toLowerCase().includes(w))) { score += 8; reasons.push('Matches a spec you care about'); }
    if (wished.has(String(p._id))) { score += 6; reasons.push('On your wishlist'); }
    const off = p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
    if (off >= 10) { score += Math.min(off, 25) / 5; reasons.push(`${off}% below list price`); }
    if (prefs.maxBudget) reasons.push('Within your saved budget');
    if (!reasons.length) reasons.push(`Highly rated (${p.rating}/5)`);
    return { p, score, reasons };
  }).sort((a, b) => b.score - a.score).slice(0, limit);

  const basis = prefs.categories?.length || prefs.brands?.length || prefs.maxBudget ? 'preferences' : known.length ? 'activity' : 'top_rated';
  return { basis, items: scored.map((x) => ({ ...pub(x.p), reasons: x.reasons })) };
}
