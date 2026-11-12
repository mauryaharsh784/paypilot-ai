import mongoose, { Schema } from 'mongoose';

const { ObjectId, Mixed } = Schema.Types;
const t = { timestamps: true };
const ref = (m: string) => ({ type: ObjectId, ref: m, required: true });

export const User = mongoose.model('User', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  preferences: {
    brands: { type: [String], default: [] },
    categories: { type: [String], default: [] },
    maxBudget: { type: Number, min: 0 },
    specs: { type: [String], default: [] },
  },
  settings: {
    aiMemory: { type: Boolean, default: true },
    priceAlerts: { type: Boolean, default: true },
  },
}, t));

export const Product = mongoose.model('Product', new Schema({
  slug: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  brand: { type: String, required: true },
  category: { type: String, required: true, index: true },
  price: { type: Number, required: true, min: 0 },
  mrp: { type: Number, required: true, min: 0 },
  rating: { type: Number, default: 4 },
  reviews: { type: Number, default: 0 },
  description: { type: String, default: '' },
  specs: { type: Mixed, default: {} },
  tags: { type: [String], default: [] },
  stock: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true },
  image: { type: String, trim: true, maxlength: 500 }, // optional: '/products/x.jpg' or an https URL. When empty the client derives /products/<slug>.svg
}, t));

export const PricePoint = mongoose.model('PricePoint', new Schema({
  productId: { ...ref('Product'), index: true },
  price: { type: Number, required: true },
  at: { type: Date, default: Date.now },
}));

export const Cart = mongoose.model('Cart', new Schema({
  userId: { ...ref('User'), unique: true },
  items: [{ _id: false, productId: ref('Product'), quantity: { type: Number, min: 1, max: 10, default: 1 } }],
  budget: { type: Number, min: 0 },
}, t));

const orderSchema = new Schema({
  userId: { ...ref('User'), index: true },
  items: [{ _id: false, productId: ref('Product'), name: String, price: Number, quantity: Number, slug: String, category: String, image: String }],
  subtotal: Number, shipping: Number, total: Number,
  chargeCurrency: String, chargeAmount: Number, fxRate: Number,
  status: { type: String, enum: ['awaiting_approval', 'awaiting_payment', 'paid', 'failed', 'cancelled'], default: 'awaiting_approval', index: true },
  paypalOrderId: { type: String, index: true, sparse: true },
  captureId: String,
  approvedAt: Date, paidAt: Date,
  captureLock: Boolean,
  paypalAttempt: { type: Number, default: 0 }, // bumped each time a new PayPal order is needed for this order (keeps PayPal-Request-Id unique)
  failureReason: String,
  refundedAt: Date,
}, t);
export const Order = mongoose.model('Order', orderSchema);

const txSchema = new Schema({
  userId: { ...ref('User'), index: true },
  orderId: { ...ref('Order'), index: true },
  paypalOrderId: String, captureId: String,
  kind: { type: String, enum: ['capture', 'failure', 'cancel', 'refund', 'pending'], required: true },
  status: { type: String, required: true },
  amount: Number, currency: String,
  source: { type: String, enum: ['capture', 'webhook', 'client', 'sync'], default: 'capture' },
  detail: Mixed,
}, t);
txSchema.index({ captureId: 1 }, { unique: true, partialFilterExpression: { kind: 'capture', captureId: { $type: 'string' } } });
export const Transaction = mongoose.model('Transaction', txSchema);

export const WebhookEvent = mongoose.model('WebhookEvent', new Schema({
  eventId: { type: String, required: true, unique: true },
  eventType: String,
  summary: String,
  outcome: String,
  claimedAt: Date, // when processing started; an event with no outcome and an old claimedAt is a crashed run and may be taken over
}, t));

const wl = new Schema({ userId: ref('User'), productId: ref('Product') }, t);
wl.index({ userId: 1, productId: 1 }, { unique: true });
export const Wishlist = mongoose.model('Wishlist', wl);

const pw = new Schema({
  userId: ref('User'), productId: ref('Product'),
  targetPrice: { type: Number, required: true, min: 1 },
  lastNotifiedPrice: Number,
  active: { type: Boolean, default: true },
}, t);
pw.index({ userId: 1, productId: 1 }, { unique: true });
export const PriceWatch = mongoose.model('PriceWatch', pw);

export const Notification = mongoose.model('Notification', new Schema({
  userId: { ...ref('User'), index: true },
  type: String, title: String, body: String, link: String,
  read: { type: Boolean, default: false },
}, t));

export const ChatSession = mongoose.model('ChatSession', new Schema({
  userId: { ...ref('User'), unique: true },
  messages: { type: [Mixed], default: [] },
  lastResults: { type: [ObjectId], default: [] },
}, t));

// One row per assistant request, so admins can monitor AI activity. Message text is a short preview only (see agents.ts).
const runSchema = new Schema({
  userId: { ...ref('User'), index: true },
  message: { type: String, maxlength: 160 },
  action: String,
  mode: String,
  ok: { type: Boolean, default: true },
  error: String,
  durationMs: Number,
  cards: { type: Number, default: 0 },
  agents: [{ _id: false, agent: String, mode: String, ms: Number, tools: [String], llmError: String }],
}, t);
runSchema.index({ createdAt: -1 });
export const AgentRun = mongoose.model('AgentRun', runSchema);

export async function notify(userId: any, type: string, title: string, body: string, link?: string) {
  await Notification.create({ userId, type, title, body, link });
}
