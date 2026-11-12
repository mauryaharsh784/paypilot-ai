export const inr = (n?: number | null) => (n == null ? '–' : '₹' + Math.round(n).toLocaleString('en-IN'));
export const date = (d?: string | Date | null) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
export const short = (id: string) => id.slice(-8).toUpperCase();
export const statusLabel: Record<string, string> = {
  awaiting_approval: 'Awaiting approval', awaiting_payment: 'Awaiting payment', paid: 'Paid', failed: 'Failed', cancelled: 'Cancelled',
  completed: 'Completed', rejected: 'Rejected', denied: 'Denied', pending: 'Pending', refunded: 'Refunded',
};
export const statusTone = (s: string) =>
  ['paid', 'completed'].includes(s) ? 'bg-ok/10 text-ok'
  : ['failed', 'rejected', 'denied'].includes(s) ? 'bg-bad/10 text-bad'
  : ['cancelled', 'refunded'].includes(s) ? 'bg-slate-100 text-slate-600'
  : 'bg-amber-50 text-warn';
export const discountPct = (price: number, mrp: number) => (mrp > price ? Math.round((1 - price / mrp) * 100) : 0);
