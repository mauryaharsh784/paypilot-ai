import { Router } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import { AgentRun, Cart, ChatSession, Notification, Order, PricePoint, PriceWatch, Product, Transaction, User, WebhookEvent, Wishlist, notify } from './models';
import { AppError, esc, h, oid, inr } from './http';
import { config } from './config';
import { requireAdmin, requireAuth, publicUser } from './auth';
import * as T from './tools';
import { capturePayment, initiatePayment, markPaid, prepareOrder } from './payments';
import { paypal } from './paypal';
import { AGENTS, handleMessage } from './agents';
import { llmEnabled } from './llm';

export const api = Router();

api.get('/config', (_req, res) => res.json({
  paypalClientId: config.paypal.clientId, paypalConfigured: paypal.configured(), webhookConfigured: !!config.paypal.webhookId,
  currency: config.paypal.currency, inrPerUnit: config.paypal.inrPerUnit,
  ai: llmEnabled() ? config.ai.provider : 'rules',
}));

/* ---------------- catalog (public) ---------------- */
api.get('/products/meta', h(async (_req, res) => {
  const [categories, brands, range] = await Promise.all([
    Product.distinct('category', { active: true }), Product.distinct('brand', { active: true }),
    Product.aggregate([{ $match: { active: true } }, { $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } }]),
  ]);
  res.json({ categories, brands, min: range[0]?.min ?? 0, max: range[0]?.max ?? 0 });
}));

const listProducts = h(async (req, res) => {
  const q = z.object({
    q: z.string().optional(), category: z.string().optional(), brand: z.string().optional(),
    minPrice: z.coerce.number().optional(), maxPrice: z.coerce.number().optional(),
    sort: z.enum(['relevance', 'price_asc', 'price_desc', 'rating']).default('relevance'),
    page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(48).default(12),
  }).parse(req.query);
  const f: any = { active: true };
  if (q.category) f.category = q.category;
  if (q.brand) f.brand = q.brand;
  if (q.minPrice || q.maxPrice) f.price = { ...(q.minPrice ? { $gte: q.minPrice } : {}), ...(q.maxPrice ? { $lte: q.maxPrice } : {}) };
  if (q.q) { const r = new RegExp(esc(q.q), 'i'); f.$or = [{ name: r }, { brand: r }, { tags: r }, { description: r }]; }
  const sort: any = q.sort === 'price_asc' ? { price: 1 } : q.sort === 'price_desc' ? { price: -1 } : { rating: -1, reviews: -1 };
  const [items, total] = await Promise.all([Product.find(f).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).lean(), Product.countDocuments(f)]);
  res.json({ items: items.map(T.pub), total, page: q.page, pages: Math.ceil(total / q.limit) });
});
api.get('/products', listProducts);
api.get('/products/search', listProducts); // spec alias

api.get('/compare', h(async (req, res) => res.json(await T.compareProducts(String(req.query.ids || '').split(',').filter(Boolean)))));

api.post('/products/compare', h(async (req, res) => {
  const b = z.object({ ids: z.array(z.string()).min(2).max(4) }).parse(req.body);
  res.json(await T.compareProducts(b.ids.map(oid)));
}));

api.get('/products/:id', h(async (req, res) => {
  const p = await T.getProduct(oid(req.params.id)) as any;
  if (p.error) throw new AppError(404, p.error, 'NOT_FOUND');
  res.json({ product: p, history: (await T.priceHistory(p.id)).map((x: any) => ({ at: x.at, price: x.price })) });
}));

/* ---------------- everything below needs sign-in ---------------- */
api.use(requireAuth);

/* cart */
api.get('/cart', h(async (req, res) => res.json(await T.getCartSummary(req.user.id))));
api.post('/cart/items', h(async (req, res) => {
  const b = z.object({ productId: z.string(), quantity: z.number().int().min(1).max(10).default(1) }).parse(req.body);
  res.json(await T.cartAdd(req.user.id, oid(b.productId), b.quantity));
}));
api.patch('/cart/items/:productId', h(async (req, res) => {
  const b = z.object({ quantity: z.number().int().min(0).max(10) }).parse(req.body);
  res.json(await T.cartSetQuantity(req.user.id, oid(req.params.productId), b.quantity));
}));
api.delete('/cart/items/:productId', h(async (req, res) => res.json(await T.cartSetQuantity(req.user.id, oid(req.params.productId), 0))));
api.put('/cart/budget', h(async (req, res) => {
  const b = z.object({ budget: z.number().min(0).nullable() }).parse(req.body);
  await Cart.updateOne({ userId: req.user.id }, b.budget ? { $set: { budget: b.budget } } : { $unset: { budget: '' } }, { upsert: true });
  res.json(await T.getCartSummary(req.user.id));
}));

/* checkout + payments */
api.post('/checkout/prepare', h(async (req, res) => res.status(201).json({ order: await prepareOrder(req.user.id) })));
// Read-only enrichment: older orders were saved without slug/category/image, so fill them in from the catalog when they are returned.
async function withProductImages(orders: any[]) {
  const ids = [...new Set(orders.flatMap((o) => (o.items || []).map((i: any) => String(i.productId))))];
  const prods: any[] = await Product.find({ _id: { $in: ids } }).select('slug category image').lean();
  const byId = new Map(prods.map((p) => [String(p._id), p]));
  return orders.map((o) => ({
    ...o,
    items: (o.items || []).map((i: any) => {
      const p = byId.get(String(i.productId));
      return { ...i, slug: i.slug || p?.slug, category: i.category || p?.category, image: i.image || p?.image };
    }),
  }));
}
const STALE_ORDER_MS = 24 * 60 * 60_000;
api.get('/orders', h(async (req, res) => {
  // Checkouts that were never paid expire after 24 hours so the history does not fill up with dead orders. A late PayPal webhook can still mark one paid.
  await Order.updateMany(
    { userId: req.user.id, status: { $in: ['awaiting_approval', 'awaiting_payment'] }, captureLock: { $ne: true }, updatedAt: { $lt: new Date(Date.now() - STALE_ORDER_MS) } },
    { $set: { status: 'cancelled', failureReason: 'Expired after 24 hours without payment' } },
  );
  res.json({ items: await withProductImages(await Order.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean()) });
}));
api.get('/orders/:id', h(async (req, res) => {
  const order = await Order.findOne({ _id: oid(req.params.id), userId: req.user.id }).lean();
  if (!order) throw new AppError(404, 'Order not found', 'NOT_FOUND');
  res.json({ order: (await withProductImages([order]))[0], transactions: await Transaction.find({ orderId: order._id }).sort({ createdAt: -1 }).lean() });
}));
const approveOrder = h(async (req, res) => {
  z.object({ confirm: z.literal(true) }).parse(req.body); // explicit user approval is required
  res.json({ order: await initiatePayment(oid(req.params.id), req.user.id) });
});
api.post('/orders/:id/approve', approveOrder);
const captureOrder = h(async (req, res) => {
  const b = z.object({ paypalOrderId: z.string().min(5).max(64) }).parse(req.body);
  res.json(await capturePayment(oid(req.params.id), req.user.id, b.paypalOrderId));
});
api.post('/orders/:id/capture', captureOrder);
// Client-reported cancel/error. Logged only: a client message is never proof of payment status.
api.post('/orders/:id/payment-event', h(async (req, res) => {
  const b = z.object({ event: z.enum(['cancelled', 'error']), message: z.string().max(300).optional() }).parse(req.body);
  const order = await Order.findOne({ _id: oid(req.params.id), userId: req.user.id });
  if (!order) throw new AppError(404, 'Order not found');
  if (order.status !== 'paid') {
    const kind = b.event === 'cancelled' ? 'cancel' : 'failure';
    const status = b.event === 'cancelled' ? 'cancelled' : 'failed';
    // The PayPal popup can fire the same event repeatedly; log one row per order, kind and status per 10 minutes.
    const recent = await Transaction.exists({ orderId: order._id, source: 'client', kind, status, createdAt: { $gt: new Date(Date.now() - 10 * 60_000) } });
    if (!recent) await Transaction.create({ userId: req.user.id, orderId: order._id, paypalOrderId: order.paypalOrderId, kind, status, amount: order.chargeAmount, currency: order.chargeCurrency, source: 'client', detail: { message: b.message } });
  }
  res.json({ ok: true });
}));
api.post('/orders/:id/cancel', h(async (req, res) => {
  const r = await Order.findOneAndUpdate({ _id: oid(req.params.id), userId: req.user.id, status: { $in: ['awaiting_approval', 'awaiting_payment'] }, captureLock: { $ne: true } }, { $set: { status: 'cancelled', failureReason: 'Cancelled by you' } }, { new: true });
  if (!r) throw new AppError(409, 'This order can no longer be cancelled');
  res.json({ order: r });
}));
api.get('/transactions', h(async (req, res) => {
  const items: any[] = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(200).lean();
  const orders: any[] = await Order.find({ _id: { $in: [...new Set(items.map((t) => String(t.orderId)))] } }).select('total chargeAmount').lean();
  const byId = new Map(orders.map((o) => [String(o._id), o]));
  // amountInr is the order's INR total, shown only when the transaction amount is the full charge for that order.
  res.json({ items: items.map((t) => { const o = byId.get(String(t.orderId)); return { ...t, amountInr: o && t.amount != null && Math.abs(t.amount - o.chargeAmount) < 0.005 ? o.total : undefined }; }) });
}));

/* assistant */
api.get('/assistant/agents', (_req, res) => res.json({ agents: AGENTS, mode: llmEnabled() ? config.ai.provider : 'rules' }));
api.get('/assistant/session', h(async (req, res) => {
  const s = await ChatSession.findOne({ userId: req.user.id }).lean();
  res.json({ messages: s?.messages || [] });
}));
api.delete('/assistant/session', h(async (req, res) => { await ChatSession.deleteOne({ userId: req.user.id }); res.json({ ok: true }); }));
const assistantMessage = h(async (req, res) => {
  const b = z.object({ message: z.string().trim().min(1).max(1000) }).parse(req.body);
  res.json(await handleMessage(req.user.id, b.message));
});
api.post('/assistant/message', assistantMessage);
api.post('/ai/chat', assistantMessage); // spec alias
api.post('/ai/agent/run', assistantMessage); // spec alias: runs the full agent pipeline and returns the tool trace

/* profile, memory, settings */
api.get('/me/counts', h(async (req, res) => {
  const [cart, unread] = await Promise.all([T.getCartSummary(req.user.id), Notification.countDocuments({ userId: req.user.id, read: false })]);
  res.json({ cart: cart.itemCount, unread });
}));
api.put('/me', h(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.body);
  res.json({ user: publicUser(await User.findByIdAndUpdate(req.user.id, b, { new: true })) });
}));
const prefSchema = z.object({
  brands: z.array(z.string().trim().max(40)).max(20), categories: z.array(z.string().trim().max(40)).max(10),
  maxBudget: z.number().min(0).nullable(), specs: z.array(z.string().trim().max(60)).max(20),
});
api.put('/me/preferences', h(async (req, res) => {
  const b = prefSchema.parse(req.body);
  const set: any = { 'preferences.brands': b.brands, 'preferences.categories': b.categories, 'preferences.specs': b.specs };
  const op: any = { $set: set };
  if (b.maxBudget) set['preferences.maxBudget'] = b.maxBudget; else op.$unset = { 'preferences.maxBudget': '' };
  res.json({ user: publicUser(await User.findByIdAndUpdate(req.user.id, op, { new: true })) });
}));
// Merge preferences the user approved from an assistant suggestion.
api.post('/me/preferences/merge', h(async (req, res) => {
  const b = prefSchema.partial().parse(req.body);
  const u: any = await User.findById(req.user.id);
  const uniq = (a: string[] = [], c: string[] = []) => Array.from(new Set([...a, ...c]));
  u.preferences.brands = uniq(u.preferences.brands, b.brands);
  u.preferences.categories = uniq(u.preferences.categories, b.categories);
  u.preferences.specs = uniq(u.preferences.specs, b.specs);
  if (b.maxBudget) u.preferences.maxBudget = b.maxBudget;
  await u.save();
  res.json({ user: publicUser(u) });
}));
api.delete('/me/preferences', h(async (req, res) => {
  const u = await User.findByIdAndUpdate(req.user.id, { $set: { 'preferences.brands': [], 'preferences.categories': [], 'preferences.specs': [] }, $unset: { 'preferences.maxBudget': '' } }, { new: true });
  res.json({ user: publicUser(u) });
}));
api.put('/me/settings', h(async (req, res) => {
  const b = z.object({ aiMemory: z.boolean(), priceAlerts: z.boolean() }).parse(req.body);
  res.json({ user: publicUser(await User.findByIdAndUpdate(req.user.id, { $set: { 'settings.aiMemory': b.aiMemory, 'settings.priceAlerts': b.priceAlerts } }, { new: true })) });
}));
api.get('/me/shopping-history', h(async (req, res) => {
  const orders = await Order.find({ userId: req.user.id, status: 'paid' }).sort({ paidAt: -1 }).limit(20).lean();
  res.json({ items: orders.flatMap((o: any) => o.items.map((i: any) => ({ name: i.name, quantity: i.quantity, price: i.price, at: o.paidAt }))) });
}));

/* wishlist */
api.get('/wishlist', h(async (req, res) => {
  const rows = await Wishlist.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
  const prods = await Product.find({ _id: { $in: rows.map((r: any) => r.productId) } }).lean();
  res.json({ items: rows.map((r: any) => prods.find((p: any) => String(p._id) === String(r.productId))).filter(Boolean).map(T.pub) });
}));
const addWishlist = h(async (req, res) => {
  const id = oid(req.params.productId);
  if (!(await Product.exists({ _id: id }))) throw new AppError(404, 'Product not found');
  await Wishlist.updateOne({ userId: req.user.id, productId: id }, { $setOnInsert: { userId: req.user.id, productId: id } }, { upsert: true });
  res.json({ ok: true });
});
api.post('/wishlist/:productId', addWishlist);
api.delete('/wishlist/:productId', h(async (req, res) => { await Wishlist.deleteOne({ userId: req.user.id, productId: oid(req.params.productId) }); res.json({ ok: true }); }));

/* price watch: alerts only fire on real price changes recorded when the catalog price is updated */
const listWatches = h(async (req, res) => {
  const rows = await PriceWatch.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
  const prods = await Product.find({ _id: { $in: rows.map((r: any) => r.productId) } }).lean();
  const hist = await PricePoint.find({ productId: { $in: rows.map((r: any) => r.productId) } }).sort({ at: 1 }).lean();
  res.json({ items: rows.map((r: any) => {
    const p = prods.find((x: any) => String(x._id) === String(r.productId));
    return p && { ...r, product: T.pub(p), history: hist.filter((x: any) => String(x.productId) === String(r.productId)).map((x: any) => ({ at: x.at, price: x.price })) };
  }).filter(Boolean) });
});
api.get('/watches', listWatches);
const putWatch = h(async (req, res) => {
  const b = z.object({ targetPrice: z.number().positive() }).parse(req.body);
  const id = oid(req.params.productId);
  const p: any = await Product.findById(id).lean();
  if (!p) throw new AppError(404, 'Product not found');
  const w = await PriceWatch.findOneAndUpdate({ userId: req.user.id, productId: id }, { $set: { targetPrice: b.targetPrice, active: true } }, { upsert: true, new: true });
  res.json({ watch: w, alreadyBelowTarget: p.price <= b.targetPrice });
});
api.put('/watches/:productId', putWatch);
const deleteWatch = h(async (req, res) => { await PriceWatch.deleteOne({ userId: req.user.id, productId: oid(req.params.productId) }); res.json({ ok: true }); });
api.delete('/watches/:productId', deleteWatch);

/* notifications */
api.get('/notifications', h(async (req, res) => res.json({ items: await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(100).lean() })));
api.post('/notifications/read-all', h(async (req, res) => { await Notification.updateMany({ userId: req.user.id, read: false }, { read: true }); res.json({ ok: true }); }));
api.post('/notifications/:id/read', h(async (req, res) => { await Notification.updateOne({ _id: oid(req.params.id), userId: req.user.id }, { read: true }); res.json({ ok: true }); }));


/* ---------------- spec-shaped endpoints (thin wrappers over the handlers above) ---------------- */
// Bodies carry ids here; the originals use URL params. Both shapes are supported and share one implementation.
const withParams = (fn: any, map: (req: any) => Record<string, string>) => (req: any, res: any, next: any) => { req.params = { ...req.params, ...map(req) }; fn(req, res, next); };
api.post('/paypal/create-order', withParams(approveOrder, (r) => ({ id: String(r.body?.orderId ?? '') })));
api.post('/paypal/capture-order', withParams(captureOrder, (r) => ({ id: String(r.body?.orderId ?? '') })));
api.post('/wishlist', withParams(addWishlist, (r) => ({ productId: String(r.body?.productId ?? '') })));
api.get('/price-watch', listWatches);
api.post('/price-watch', withParams(putWatch, (r) => ({ productId: String(r.body?.productId ?? '') })));
api.delete('/price-watch/:productId', deleteWatch);

api.post('/ai/recommendations', h(async (req, res) => res.json(await T.recommendProducts(req.user.id, 6))));
api.get('/ai/recommendations', h(async (req, res) => res.json(await T.recommendProducts(req.user.id, 6))));

api.get('/preferences', h(async (req, res) => res.json({ preferences: (await User.findById(req.user.id).lean())?.preferences ?? {} })));
api.patch('/preferences', h(async (req, res) => {
  const b = prefSchema.partial().parse(req.body);
  const set: any = {}; const unset: any = {};
  if (b.brands) set['preferences.brands'] = b.brands;
  if (b.categories) set['preferences.categories'] = b.categories;
  if (b.specs) set['preferences.specs'] = b.specs;
  if (b.maxBudget !== undefined) { if (b.maxBudget) set['preferences.maxBudget'] = b.maxBudget; else unset['preferences.maxBudget'] = ''; }
  const op: any = {}; if (Object.keys(set).length) op.$set = set; if (Object.keys(unset).length) op.$unset = unset;
  const u = Object.keys(op).length ? await User.findByIdAndUpdate(req.user.id, op, { new: true }) : await User.findById(req.user.id);
  res.json({ user: publicUser(u) });
}));

/* dashboard: every figure below is computed from the user's own database records */
api.get('/dashboard', h(async (req, res) => {
  const uid = req.user.id;
  const [orders, cart, wl, watches, unread, user, txAgg, recs, runs, wlRecent, watchRecent] = await Promise.all([
    Order.find({ userId: uid }).sort({ createdAt: -1 }).lean(), T.getCartSummary(uid),
    Wishlist.countDocuments({ userId: uid }), PriceWatch.countDocuments({ userId: uid, active: true }),
    Notification.countDocuments({ userId: uid, read: false }),
    User.findById(uid).lean() as any,
    Transaction.aggregate([{ $match: { userId: new Types.ObjectId(uid) } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    T.recommendProducts(uid, 4),
    AgentRun.find({ userId: uid }).sort({ createdAt: -1 }).limit(8).lean(),
    Wishlist.find({ userId: uid }).sort({ createdAt: -1 }).limit(5).populate('productId', 'name').lean(),
    PriceWatch.find({ userId: uid }).sort({ createdAt: -1 }).limit(5).populate('productId', 'name').lean(),
  ]);
  const paid = orders.filter((o: any) => o.status === 'paid');
  const byMonth: Record<string, number> = {};
  paid.forEach((o: any) => { const k = new Date(o.paidAt).toISOString().slice(0, 7); byMonth[k] = (byMonth[k] || 0) + o.total; });
  const spent = paid.reduce((s: number, o: any) => s + o.total, 0);
  const txByStatus = txAgg.map((x: any) => ({ status: x._id, count: x.count })).sort((a: any, b: any) => b.count - a.count);
  const prefBudget = user?.preferences?.maxBudget ?? null;

  const activity: { at: Date; type: string; text: string; link?: string }[] = [
    ...orders.slice(0, 8).map((o: any) => ({ at: o.paidAt && o.status === 'paid' ? o.paidAt : o.createdAt, type: 'order', text: o.status === 'paid' ? `Paid order #${String(o._id).slice(-8)} (${inr(o.total)})` : `Order #${String(o._id).slice(-8)} is ${o.status.replace('_', ' ')}`, link: `/orders/${o._id}` })),
    ...runs.map((r: any) => ({ at: r.createdAt, type: 'ai', text: r.ok ? `Asked the AI assistant${r.cards ? ` and got ${r.cards} product${r.cards > 1 ? 's' : ''}` : ''}` : 'An assistant request failed', link: '/assistant' })),
    ...wlRecent.filter((w: any) => w.productId).map((w: any) => ({ at: w.createdAt, type: 'wishlist', text: `Saved ${w.productId.name} to your wishlist`, link: '/wishlist' })),
    ...watchRecent.filter((w: any) => w.productId).map((w: any) => ({ at: w.createdAt, type: 'watch', text: `Watching ${w.productId.name} for ${inr(w.targetPrice)}`, link: '/watch' })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 8);

  res.json({
    stats: {
      orders: orders.length, paidOrders: paid.length, spent,
      ordersByStatus: orders.reduce((m: Record<string, number>, o: any) => { m[o.status] = (m[o.status] || 0) + 1; return m; }, {}),
      totalPurchases: paid.reduce((n: number, o: any) => n + o.items.reduce((m: number, i: any) => m + i.quantity, 0), 0),
      successfulTransactions: txAgg.find((x: any) => x._id === 'completed')?.count ?? 0,
      cartItems: cart.itemCount, cartTotal: cart.total, wishlist: wl, watches, unread,
    },
    budget: {
      cartBudget: cart.budget, cartTotal: cart.total, cartRemaining: cart.budgetRemaining, preferredMaxBudget: prefBudget,
      averageOrderValue: paid.length ? Math.round(spent / paid.length) : 0,
      largestOrder: paid.reduce((m: number, o: any) => Math.max(m, o.total), 0),
    },
    spendByMonth: Object.entries(byMonth).sort().map(([month, total]) => ({ month, total })),
    transactionsByStatus: txByStatus,
    recommendations: recs,
    activity,
    recentOrders: orders.slice(0, 5),
  });
}));

/* ---------------- admin ---------------- */
const admin = Router();
admin.use(requireAdmin);
const adminStats = h(async (_req, res) => {
  const day = 86_400_000, now = Date.now();
  const [users, orders, paid, events, recent, byDay, statusCounts, txAgg, runAgg, byCategory] = await Promise.all([
    User.countDocuments(), Order.countDocuments(), Order.find({ status: 'paid' }).lean(), WebhookEvent.countDocuments(),
    Transaction.find().sort({ createdAt: -1 }).limit(10).lean(),
    Order.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } }, revenue: { $sum: '$total' }, orders: { $sum: 1 } } }, { $sort: { _id: 1 } }, { $limit: 30 }]),
    Order.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Transaction.aggregate([{ $group: { _id: { kind: '$kind', status: '$status' }, n: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
    AgentRun.aggregate([{ $group: { _id: null, total: { $sum: 1 }, failed: { $sum: { $cond: ['$ok', 0, 1] } }, avgMs: { $avg: '$durationMs' } } }]),
    Order.aggregate([{ $match: { status: 'paid' } }, { $unwind: '$items' }, { $lookup: { from: 'products', localField: 'items.productId', foreignField: '_id', as: 'p' } }, { $unwind: '$p' }, { $group: { _id: '$p.category', revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }, units: { $sum: '$items.quantity' } } }, { $sort: { revenue: -1 } }]),
  ]);
  const since = (d: number) => paid.filter((o: any) => +new Date(o.paidAt) >= now - d * day).reduce((s: number, o: any) => s + o.total, 0);
  const revenueInr = paid.reduce((s: number, o: any) => s + o.total, 0);
  const attempted = statusCounts.filter((c: any) => ['paid', 'failed', 'awaiting_payment'].includes(c._id)).reduce((s: number, c: any) => s + c.n, 0);
  res.json({
    users, orders, paidOrders: paid.length, revenueInr, webhookEvents: events, statusCounts, recentTransactions: recent,
    revenueByDay: byDay.map((d: any) => ({ day: d._id, revenue: d.revenue, orders: d.orders })),
    revenue: { today: since(1), last7Days: since(7), last30Days: since(30), allTime: revenueInr, averageOrderValue: paid.length ? Math.round(revenueInr / paid.length) : 0 },
    revenueByCategory: byCategory.map((c: any) => ({ category: c._id, revenue: c.revenue, units: c.units })),
    paymentOverview: {
      byOutcome: txAgg.map((t: any) => ({ kind: t._id.kind, status: t._id.status, count: t.n, amount: Math.round(t.amount * 100) / 100 })),
      conversion: attempted ? Math.round((paid.length / attempted) * 100) : null,
    },
    ai: { runs: runAgg[0]?.total ?? 0, failed: runAgg[0]?.failed ?? 0, avgMs: Math.round(runAgg[0]?.avgMs ?? 0), mode: llmEnabled() ? config.ai.provider : 'rules' },
  });
});
admin.get('/stats', adminStats);
admin.get('/analytics', adminStats); // spec alias

admin.get('/users', h(async (req, res) => {
  const q = z.object({ q: z.string().trim().max(80).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
  const f: any = q.q ? { $or: [{ name: new RegExp(esc(q.q), 'i') }, { email: new RegExp(esc(q.q), 'i') }] } : {};
  const [users, total] = await Promise.all([User.find(f).select('name email role createdAt').sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(), User.countDocuments(f)]);
  const ids = users.map((u: any) => u._id);
  const [agg, runs] = await Promise.all([
    Order.aggregate([{ $match: { userId: { $in: ids } } }, { $group: { _id: '$userId', orders: { $sum: 1 }, paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } }, spent: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$total', 0] } } } }]),
    AgentRun.aggregate([{ $match: { userId: { $in: ids } } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]),
  ]);
  res.json({ total, page: q.page, pages: Math.ceil(total / q.limit), items: users.map((u: any) => {
    const a = agg.find((x: any) => String(x._id) === String(u._id)); const r = runs.find((x: any) => String(x._id) === String(u._id));
    return { id: String(u._id), name: u.name, email: u.email, role: u.role, createdAt: u.createdAt, orders: a?.orders ?? 0, paidOrders: a?.paid ?? 0, spent: a?.spent ?? 0, aiRuns: r?.n ?? 0 };
  }) });
}));
// Role changes. An admin cannot change their own role, and the last admin can never be demoted.
admin.patch('/users/:id', h(async (req, res) => {
  const b = z.object({ role: z.enum(['user', 'admin']) }).parse(req.body);
  const id = oid(req.params.id);
  if (id === req.user.id) throw new AppError(400, 'You cannot change your own role', 'SELF_ROLE_CHANGE');
  const target: any = await User.findById(id);
  if (!target) throw new AppError(404, 'User not found', 'NOT_FOUND');
  if (target.role === 'admin' && b.role === 'user' && (await User.countDocuments({ role: 'admin' })) <= 1) throw new AppError(409, 'At least one admin must remain', 'LAST_ADMIN');
  target.role = b.role;
  await target.save();
  res.json({ user: { id: String(target._id), name: target.name, email: target.email, role: target.role } });
}));

admin.get('/ai-activity', h(async (_req, res) => {
  const [recent, byAction, byAgent] = await Promise.all([
    AgentRun.find().sort({ createdAt: -1 }).limit(50).populate('userId', 'email').lean(),
    AgentRun.aggregate([{ $group: { _id: '$action', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    AgentRun.aggregate([{ $unwind: '$agents' }, { $group: { _id: '$agents.agent', calls: { $sum: 1 }, avgMs: { $avg: '$agents.ms' }, toolCalls: { $sum: { $size: { $ifNull: ['$agents.tools', []] } } }, llmFallbacks: { $sum: { $cond: [{ $ifNull: ['$agents.llmError', false] }, 1, 0] } } } }, { $sort: { calls: -1 } }]),
  ]);
  res.json({
    mode: llmEnabled() ? config.ai.provider : 'rules',
    byAction: byAction.map((x: any) => ({ action: x._id || 'unknown', count: x.n })),
    byAgent: byAgent.map((x: any) => ({ agent: x._id, calls: x.calls, avgMs: Math.round(x.avgMs), toolCalls: x.toolCalls, llmFallbacks: x.llmFallbacks })),
    recent: recent.map((r: any) => ({ id: String(r._id), at: r.createdAt, user: r.userId?.email || 'deleted user', message: r.message, action: r.action, mode: r.mode, ok: r.ok, error: r.error, durationMs: r.durationMs, cards: r.cards })),
  });
}));
admin.get('/orders', h(async (_req, res) => res.json({ items: await Order.find().sort({ createdAt: -1 }).limit(100).populate('userId', 'name email').lean() })));
admin.get('/webhooks', h(async (_req, res) => res.json({ items: await WebhookEvent.find().sort({ createdAt: -1 }).limit(50).lean() })));
admin.get('/products', h(async (_req, res) => res.json({ items: (await Product.find().sort({ category: 1, name: 1 }).lean()).map((p: any) => ({ ...T.pub(p), active: p.active })) })));

const productBody = z.object({
  name: z.string().min(2), brand: z.string().min(1), category: z.string().min(2), price: z.number().positive(), mrp: z.number().positive(),
  rating: z.number().min(0).max(5).default(4), reviews: z.number().int().min(0).default(0), description: z.string().default(''),
  specs: z.record(z.union([z.string(), z.number()])).default({}), tags: z.array(z.string()).default([]), stock: z.number().int().min(0).default(0), active: z.boolean().default(true),
  image: z.string().max(500).regex(/^(\/|https:\/\/)/, 'image must be a /path or an https:// URL').optional(),
});
async function onPriceChange(p: any, oldPrice: number) {
  await PricePoint.create({ productId: p._id, price: p.price });
  const watches = await PriceWatch.find({ productId: p._id, active: true }).lean();
  for (const w of watches as any[]) {
    const u: any = await User.findById(w.userId).lean();
    if (!u || u.settings?.priceAlerts === false || w.lastNotifiedPrice === p.price) continue;
    const hit = p.price <= w.targetPrice;
    await notify(w.userId, hit ? 'price_target' : 'price_change', hit ? `${p.name} hit your target` : `${p.name} price changed`,
      `${inr(oldPrice)} to ${inr(p.price)}${hit ? ` (target ${inr(w.targetPrice)})` : ''}.`, `/product/${p._id}`);
    await PriceWatch.updateOne({ _id: w._id }, { lastNotifiedPrice: p.price });
  }
}
admin.post('/products', h(async (req, res) => {
  const b = productBody.parse(req.body);
  const slug = `${b.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
  const p = await Product.create({ ...b, slug });
  await PricePoint.create({ productId: p._id, price: p.price });
  res.status(201).json({ product: T.pub(p) });
}));
admin.put('/products/:id', h(async (req, res) => {
  const b = productBody.partial().parse(req.body);
  const before: any = await Product.findById(oid(req.params.id)).lean();
  if (!before) throw new AppError(404, 'Product not found');
  const p: any = await Product.findByIdAndUpdate(before._id, b, { new: true });
  if (b.price !== undefined && b.price !== before.price) await onPriceChange(p, before.price);
  res.json({ product: T.pub(p) });
}));
// Reconcile one order with PayPal (for example a webhook that never arrived). Uses the same verification and idempotent markPaid as every other path.
admin.post('/orders/:id/sync', h(async (req, res) => {
  const order = await Order.findById(oid(req.params.id));
  if (!order) throw new AppError(404, 'Order not found', 'NOT_FOUND');
  if (order.status === 'paid') return res.json({ order, synced: false, reason: 'already_paid' });
  if (!order.paypalOrderId) throw new AppError(409, 'This order has no PayPal order yet', 'NO_PAYPAL_ORDER');
  if (!paypal.configured()) throw new AppError(503, 'PayPal sandbox credentials are not set on the server', 'PAYPAL_NOT_CONFIGURED');
  const pp = await paypal.getOrder(order.paypalOrderId);
  const unit = pp.purchase_units?.[0];
  const cap = unit?.payments?.captures?.[0];
  if (!cap) return res.json({ order, synced: false, reason: 'no_capture', paypalStatus: pp.status });
  if (cap.status !== 'COMPLETED') return res.json({ order, synced: false, reason: `capture_${String(cap.status).toLowerCase()}`, paypalStatus: pp.status });
  const r = await markPaid(order._id, { captureId: cap.id, amount: cap.amount.value, currency: cap.amount.currency_code, customId: cap.custom_id || unit.custom_id, status: cap.status }, 'sync');
  res.json({ order: r.order, synced: !r.already, reason: r.already ? 'already_paid' : 'marked_paid' });
}));
admin.delete('/products/:id', h(async (req, res) => { await Product.updateOne({ _id: oid(req.params.id) }, { active: false }); res.json({ ok: true }); }));
api.use('/admin', admin);

/* ---------------- PayPal webhook (mounted separately with a raw body) ---------------- */
export const webhookHandler = h(async (req, res) => {
  const raw: string = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  // Reject early, without calling PayPal, when the request lacks the signature headers PayPal always sends.
  const required = ['paypal-transmission-id', 'paypal-transmission-time', 'paypal-transmission-sig', 'paypal-cert-url', 'paypal-auth-algo'];
  if (required.some((k) => !req.headers[k])) return res.status(400).json({ error: 'Missing PayPal signature headers' });
  let ok = false;
  try { ok = raw ? await paypal.verifyWebhook(req.headers, raw) : false; } catch { ok = false; }
  if (!ok) return res.status(400).json({ error: 'Webhook signature could not be verified' });

  const ev = JSON.parse(raw);
  try { await WebhookEvent.create({ eventId: ev.id, eventType: ev.event_type, summary: ev.summary, claimedAt: new Date() }); }
  catch (e: any) {
    if (e.code !== 11000) throw e;
    const prev: any = await WebhookEvent.findOne({ eventId: ev.id }).lean();
    if (prev?.outcome) return res.json({ ok: true, duplicate: true });
    // No outcome yet: either another delivery is still running, or an earlier run crashed before finishing.
    const since = new Date(prev?.claimedAt || prev?.createdAt || 0).getTime();
    if (!prev || Date.now() - since < 2 * 60_000) return res.status(409).json({ error: 'This event is still being processed. Retry shortly.', code: 'EVENT_IN_PROGRESS' });
    await WebhookEvent.updateOne({ eventId: ev.id }, { $set: { claimedAt: new Date() } }); // take over the stalled event; markPaid is idempotent
  }

  try {
    const r = ev.resource || {};
    const findOrder = async () => {
      if (r.custom_id && Types.ObjectId.isValid(r.custom_id)) { const o = await Order.findById(r.custom_id); if (o) return o; }
      const ppId = r.supplementary_data?.related_ids?.order_id;
      return ppId ? Order.findOne({ paypalOrderId: ppId }) : null;
    };
    let outcome = 'ignored';
    if (ev.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const o = await findOrder();
      if (o) {
        const relId = r.supplementary_data?.related_ids?.order_id;
        if (relId && o.paypalOrderId && relId !== o.paypalOrderId) outcome = 'order_mismatch'; // capture belongs to a different PayPal order than the one we hold: never mark paid
        else {
          const customId = r.custom_id || (relId && relId === o.paypalOrderId ? String(o._id) : undefined);
          const m = await markPaid(o._id, { captureId: r.id, amount: r.amount?.value, currency: r.amount?.currency_code, customId, status: r.status }, 'webhook');
          outcome = m.already ? 'already_paid' : 'marked_paid';
        }
      }
    } else if (ev.event_type === 'PAYMENT.CAPTURE.DENIED' || ev.event_type === 'PAYMENT.CAPTURE.DECLINED') {
      const o = await findOrder();
      if (o && o.status !== 'paid') {
        await Transaction.create({ userId: o.userId, orderId: o._id, paypalOrderId: o.paypalOrderId, captureId: r.id, kind: 'failure', status: 'denied', amount: Number(r.amount?.value), currency: r.amount?.currency_code, source: 'webhook' });
        await notify(o.userId, 'payment', 'Payment was declined', `PayPal declined the payment for order ${String(o._id).slice(-8)}.`, `/orders/${o._id}`);
        outcome = 'denied';
      }
    } else if (ev.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
      const o = await Order.findOne({ captureId: (r.links || []).map((l: any) => l.href).join(' ').match(/captures\/([A-Z0-9]+)/)?.[1] });
      if (o) {
        await Order.updateOne({ _id: o._id }, { refundedAt: new Date() });
        await Transaction.create({ userId: o.userId, orderId: o._id, paypalOrderId: o.paypalOrderId, captureId: r.id, kind: 'refund', status: 'refunded', amount: Number(r.amount?.value), currency: r.amount?.currency_code, source: 'webhook' });
        await notify(o.userId, 'payment', 'Refund processed by PayPal', `A refund of ${r.amount?.value} ${r.amount?.currency_code} was recorded for order ${String(o._id).slice(-8)}.`, `/orders/${o._id}`);
        outcome = 'refunded';
      }
    }
    await WebhookEvent.updateOne({ eventId: ev.id }, { outcome });
    res.json({ ok: true, outcome });
  } catch (e) {
    await WebhookEvent.deleteOne({ eventId: ev.id }); // let PayPal retry
    throw e;
  }
});
