import { Cart, Order, Product, Transaction, User, notify } from './models';
import { AppError } from './http';
import { config } from './config';
import { computeTotals, toCharge } from './pricing';
import { paypal, PayPalError } from './paypal';
import { getCartSummary } from './tools';

/** Payment Agent, step 1: validate the cart and create an order that waits for explicit user approval. Never touches PayPal. */
export async function prepareOrder(userId: string) {
  const s = await getCartSummary(userId);
  if (!s.items.length) throw new AppError(400, 'Your cart is empty', 'CART_EMPTY');
  const bad = s.items.find((i) => !i.available || i.quantity > i.stock);
  if (bad) throw new AppError(409, `${bad.name} is not available in the quantity you chose (${bad.stock} in stock)`, 'OUT_OF_STOCK');
  await Order.updateMany(
    { userId, status: { $in: ['awaiting_approval', 'awaiting_payment'] }, captureLock: { $ne: true } },
    { $set: { status: 'cancelled', failureReason: 'Replaced by a newer checkout' } },
  );
  const fx = toCharge(s.total);
  return Order.create({
    userId,
    items: s.items.map((i) => ({ productId: i.productId, name: i.name, price: i.price, quantity: i.quantity, slug: i.slug, category: i.category, image: i.image })),
    subtotal: s.subtotal, shipping: s.shipping, total: s.total,
    chargeCurrency: fx.currency, chargeAmount: fx.amount, fxRate: config.paypal.inrPerUnit,
    status: 'awaiting_approval',
  });
}

/** Payment Agent, step 2: runs only after the user approves. Re-prices from the live catalog, then creates the PayPal order. */
export async function initiatePayment(orderId: string, userId: string) {
  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) throw new AppError(404, 'Order not found', 'NOT_FOUND');
  if (order.status === 'paid') throw new AppError(409, 'This order is already paid', 'ALREADY_PAID');
  if (order.status === 'cancelled' || order.status === 'failed') throw new AppError(409, 'This order is no longer active. Start checkout again from your cart.', 'ORDER_CLOSED');
  if (!paypal.configured()) throw new AppError(503, 'PayPal sandbox credentials are not set on the server', 'PAYPAL_NOT_CONFIGURED');

  const prods = await Product.find({ _id: { $in: order.items.map((i: any) => i.productId) } }).lean();
  let changed = false;
  for (const it of order.items as any[]) {
    const p: any = prods.find((x: any) => String(x._id) === String(it.productId));
    if (!p || !p.active || p.stock < it.quantity) throw new AppError(409, `${it.name} is no longer available in that quantity`, 'OUT_OF_STOCK');
    if (p.price !== it.price) { it.price = p.price; changed = true; }
  }
  if (changed) {
    const t = computeTotals(order.items as any);
    const fx = toCharge(t.total);
    Object.assign(order, { subtotal: t.subtotal, shipping: t.shipping, total: t.total, chargeAmount: fx.amount, chargeCurrency: fx.currency, status: 'awaiting_approval', paypalOrderId: undefined, paypalAttempt: (order.paypalAttempt || 0) + 1 });
    await order.save();
    throw new AppError(409, 'Prices changed since you reviewed this order. Review the updated total and approve again.', 'PRICE_CHANGED', { order });
  }
  if (order.paypalOrderId && order.status === 'awaiting_payment') return order;
  const pp = await paypal.createOrder({ id: String(order._id), amount: order.chargeAmount!, currency: order.chargeCurrency!, attempt: order.paypalAttempt || 0 });
  order.paypalOrderId = pp.id;
  order.status = 'awaiting_payment';
  order.approvedAt = new Date();
  await order.save();
  return order;
}

type Cap = { captureId: string; amount: string | number; currency: string; customId?: string; status: string };

/** The only place an order becomes paid. Used by both the capture endpoint and the webhook; safe to call twice. */
export async function markPaid(orderId: any, cap: Cap, source: 'capture' | 'webhook' | 'sync') {
  const order = await Order.findById(orderId);
  if (!order) throw new AppError(404, 'Order not found');
  if (order.status === 'paid') return { order, already: true };

  const amountOk = Math.abs(Number(cap.amount) - order.chargeAmount!) < 0.005 && cap.currency === order.chargeCurrency;
  const idOk = cap.customId === String(order._id); // custom_id is required: it ties the PayPal capture to exactly this order
  if (cap.status !== 'COMPLETED' || !amountOk || !idOk) {
    await Transaction.create({
      userId: order.userId, orderId: order._id, paypalOrderId: order.paypalOrderId, captureId: cap.captureId,
      kind: 'failure', status: 'rejected', amount: Number(cap.amount), currency: cap.currency, source,
      detail: { reason: 'Verification failed', expected: { amount: order.chargeAmount, currency: order.chargeCurrency }, received: cap },
    });
    throw new AppError(409, 'Payment could not be verified against the order', 'VERIFICATION_FAILED');
  }
  const paid = await Order.findOneAndUpdate(
    { _id: order._id, status: { $ne: 'paid' } },
    { $set: { status: 'paid', captureId: cap.captureId, paidAt: new Date() }, $unset: { failureReason: '' } },
    { new: true },
  );
  if (!paid) return { order: await Order.findById(orderId), already: true };

  try {
    await Transaction.create({
      userId: paid.userId, orderId: paid._id, paypalOrderId: paid.paypalOrderId, captureId: cap.captureId,
      kind: 'capture', status: 'completed', amount: Number(cap.amount), currency: cap.currency, source,
    });
  } catch (e: any) { if (e.code !== 11000) throw e; }
  const short: string[] = [];
  for (const it of paid.items as any[]) {
    const r = await Product.updateOne({ _id: it.productId, stock: { $gte: it.quantity } }, { $inc: { stock: -it.quantity } });
    if (r.modifiedCount === 0) short.push(it.name); // paid, but there was not enough stock to decrement: flag it instead of hiding it
  }
  // Remove only what was ordered. Anything the user added to the cart after checkout started stays.
  await Cart.updateOne({ userId: paid.userId }, { $pull: { items: { productId: { $in: (paid.items as any[]).map((i) => i.productId) } } } } as any);
  if (short.length) {
    await Transaction.updateOne({ orderId: paid._id, kind: 'capture', captureId: cap.captureId }, { $set: { 'detail.stockShortfall': short } });
    for (const a of await User.find({ role: 'admin' }).select('_id').lean()) {
      await notify(a._id, 'admin', 'Paid order needs attention', `Order ${String(paid._id).slice(-8)} was paid but stock was too low for: ${short.join(', ')}.`);
    }
  }
  await notify(paid.userId, 'payment', 'Payment confirmed', `Order ${String(paid._id).slice(-8)} is paid (${cap.amount} ${cap.currency}).`, `/orders/${paid._id}`);
  return { order: paid, already: false };
}

const friendly = (e: PayPalError) =>
  e.issue === 'INSTRUMENT_DECLINED' ? 'PayPal could not use that payment method. Choose another one and try again.'
  : e.issue === 'PAYER_ACTION_REQUIRED' ? 'PayPal needs you to take another step before this payment can finish.'
  : e.issue === 'ORDER_NOT_APPROVED' ? 'The PayPal payment was not approved yet.'
  : 'PayPal could not complete this payment. You have not been charged by PayPilot. Try again.';

export async function capturePayment(orderId: string, userId: string, paypalOrderId: string) {
  const order = await Order.findOne({ _id: orderId, userId });
  if (!order) throw new AppError(404, 'Order not found', 'NOT_FOUND');
  if (order.status === 'paid') return { order, already: true };
  if (order.status !== 'awaiting_payment' || !order.paypalOrderId) throw new AppError(409, 'This order has not been approved for payment', 'NOT_APPROVED');
  if (order.paypalOrderId !== paypalOrderId) throw new AppError(400, 'That PayPal order does not belong to this order', 'ORDER_MISMATCH');

  const locked = await Order.findOneAndUpdate(
    { _id: order._id, status: 'awaiting_payment', captureLock: { $ne: true } },
    { $set: { captureLock: true } }, { new: true },
  );
  if (!locked) {
    const fresh = await Order.findById(order._id);
    if (fresh?.status === 'paid') return { order: fresh, already: true };
    throw new AppError(409, 'A capture for this order is already in progress', 'CAPTURE_IN_PROGRESS');
  }
  try {
    let pp: any;
    try {
      pp = await paypal.capture(order.paypalOrderId, `capture-${order._id}${order.paypalAttempt ? `-${order.paypalAttempt}` : ''}`);
    } catch (e: any) {
      if (e instanceof PayPalError && e.issue === 'ORDER_ALREADY_CAPTURED') pp = await paypal.getOrder(order.paypalOrderId);
      else {
        const pe = e instanceof PayPalError ? e : new PayPalError(500, e.message);
        await Transaction.create({
          userId, orderId: order._id, paypalOrderId: order.paypalOrderId, kind: 'failure', status: 'failed',
          amount: order.chargeAmount, currency: order.chargeCurrency, source: 'capture',
          detail: { issue: pe.issue, message: pe.message, debugId: pe.debugId },
        });
        throw new AppError(402, friendly(pe), pe.issue || 'PAYPAL_ERROR');
      }
    }
    const unit = pp.purchase_units?.[0];
    const cap = unit?.payments?.captures?.[0];
    if (!cap) throw new AppError(402, 'PayPal returned no capture for this order', 'NO_CAPTURE');
    if (cap.status === 'PENDING') {
      await Transaction.create({
        userId, orderId: order._id, paypalOrderId: order.paypalOrderId, captureId: cap.id, kind: 'pending', status: 'pending',
        amount: Number(cap.amount.value), currency: cap.amount.currency_code, source: 'capture',
        detail: { reason: cap.status_details?.reason },
      });
      throw new AppError(202, 'PayPal is still processing this payment. The order will update when PayPal confirms it.', 'PENDING');
    }
    return await markPaid(order._id, {
      captureId: cap.id, amount: cap.amount.value, currency: cap.amount.currency_code,
      customId: cap.custom_id || unit.custom_id, status: cap.status,
    }, 'capture');
  } finally {
    await Order.updateOne({ _id: order._id, status: { $ne: 'paid' } }, { $unset: { captureLock: '' } });
  }
}
