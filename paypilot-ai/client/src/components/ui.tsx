import { ReactNode } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Clock, Inbox, Loader2, XCircle, RotateCcw, type LucideIcon } from 'lucide-react';
import { statusLabel, statusTone } from '../lib/format';

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status"><Loader2 className="h-4 w-4 animate-spin" />{label}…</div>
);
export const ErrorState = ({ message, retry }: { message: string; retry?: () => void }) => (
  <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center" role="alert">
    <span className="grid h-11 w-11 place-items-center rounded-full bg-bad/10 text-bad"><AlertTriangle className="h-5 w-5" /></span>
    <p className="max-w-md text-sm">{message}</p>
    {retry && <button className="btn-ghost btn-sm" onClick={retry}>Try again</button>}
  </div>
);
export const Empty = ({ title, hint, action, icon: I = Inbox }: { title: string; hint?: string; action?: ReactNode; icon?: LucideIcon }) => (
  <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
    <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand"><I className="h-5 w-5" /></span>
    <p className="mt-1 font-display font-semibold">{title}</p>
    {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
    {action && <div className="mt-3">{action}</div>}
  </div>
);
export const Success = ({ children }: { children: ReactNode }) => (
  <div className="flex items-start gap-2 rounded-xl border border-ok/30 bg-ok/5 px-4 py-3 text-sm" role="status"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /><div>{children}</div></div>
);

const statusIcon: Record<string, LucideIcon> = {
  paid: CheckCircle2, completed: CheckCircle2, failed: XCircle, rejected: XCircle, denied: XCircle,
  cancelled: Ban, refunded: RotateCcw, awaiting_approval: Clock, awaiting_payment: Clock, pending: Clock,
};
/** Status chip. Colour and icon both encode the state (green = verified paid, amber = pending, red = failed, grey = cancelled). */
export const Status = ({ s }: { s: string }) => {
  const I = statusIcon[s] || Clock;
  return <span className={`badge ${statusTone(s)}`}><I className="h-3 w-3" />{statusLabel[s] || s}</span>;
};
export const PageHead = ({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0"><h1 className="text-2xl font-semibold sm:text-[28px]">{title}</h1>{sub && <p className="mt-1 max-w-2xl text-sm text-muted">{sub}</p>}</div>{right}
  </div>
);
export const Field = ({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) => (
  <label className="block"><span className="label">{label}</span>{children}{error ? <span className="field-error block" role="alert">{error}</span> : hint ? <span className="hint block">{hint}</span> : null}</label>
);
export const Toggle = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-brand' : 'bg-line'}`}>
    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
  </button>
);
export const ProductGridSkeleton = ({ n = 8 }: { n?: number }) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="status" aria-label="Loading products">
    {Array.from({ length: n }).map((_, i) => (
      <div key={i} className="card overflow-hidden"><div className="skeleton aspect-[400/260] rounded-none" /><div className="space-y-3 p-4"><div className="skeleton h-3 w-1/3" /><div className="skeleton h-4 w-4/5" /><div className="skeleton h-3 w-1/2" /><div className="skeleton h-9 w-full" /></div></div>
    ))}
  </div>
);
/** Small confirmation dialog for destructive actions. */
export function ConfirmDialog({ open, title, body, confirmLabel, busy, onCancel, onConfirm }: { open: boolean; title: string; body: string; confirmLabel: string; busy?: boolean; onCancel: () => void; onConfirm: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-navy-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="cd-title" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div className="card w-full max-w-sm p-6">
        <h2 id="cd-title" className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted">{body}</p>
        <div className="mt-5 flex justify-end gap-2"><button className="btn-ghost" onClick={onCancel} autoFocus>Keep it</button><button className="btn bg-bad text-white hover:bg-bad/90" disabled={busy} onClick={onConfirm}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{confirmLabel}</button></div>
      </div>
    </div>
  );
}
