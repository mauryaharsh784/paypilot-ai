import { config } from './config';

export const FREE_SHIPPING_ABOVE = 1000;
export const FLAT_SHIPPING = 99;

export function computeTotals(lines: { price: number; quantity: number }[]) {
  const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_ABOVE ? 0 : FLAT_SHIPPING;
  return { subtotal, shipping, total: subtotal + shipping };
}

/** Catalog prices are INR (GST included). PayPal is charged in PAYPAL_CURRENCY at a fixed, configured rate. */
export function toCharge(totalInr: number) {
  const amount = Math.round((totalInr / config.paypal.inrPerUnit) * 100) / 100;
  return { currency: config.paypal.currency, amount };
}
