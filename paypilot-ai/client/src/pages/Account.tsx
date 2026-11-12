import { useEffect, useState } from 'react';
import { Brain, CheckCircle2, Cpu, Loader2, Save, ShieldCheck, Trash2, UserCircle, XCircle } from 'lucide-react';
import { api, useFetch } from '../lib/api';
import { date, inr } from '../lib/format';
import { ConfirmDialog, Field, PageHead, Spinner, Toggle } from '../components/ui';
import { useApp } from '../store';

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function Profile() {
  const { user, setUser, toast } = useApp();
  const hist = useFetch<any>('/me/shopping-history');
  const [name, setName] = useState(user?.name || '');
  const [p, setP] = useState({ brands: '', categories: '', specs: '', maxBudget: '' });
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameErr = name.trim().length > 0 && name.trim().length < 2 ? 'Name must be at least 2 characters.' : '';
  const budgetErr = p.maxBudget !== '' && (!Number.isFinite(Number(p.maxBudget)) || Number(p.maxBudget) < 0) ? 'Enter a positive amount.' : '';
  useEffect(() => {
    const x = user?.preferences || {};
    setP({ brands: (x.brands || []).join(', '), categories: (x.categories || []).join(', '), specs: (x.specs || []).join(', '), maxBudget: x.maxBudget ? String(x.maxBudget) : '' });
  }, [user?.preferences]);
  const savePrefs = async () => {
    if (budgetErr) return;
    setSaving(true);
    try { const r = await api('/me/preferences', { method: 'PUT', body: { brands: list(p.brands), categories: list(p.categories), specs: list(p.specs), maxBudget: p.maxBudget ? Number(p.maxBudget) : null } }); setUser(r.user); toast('Shopping memory updated'); }
    catch (e: any) { toast(e.message, 'bad'); } finally { setSaving(false); }
  };
  const wipe = async () => { try { const r = await api('/me/preferences', { method: 'DELETE' }); setUser(r.user); toast('Shopping memory deleted'); } catch (e: any) { toast(e.message, 'bad'); } finally { setConfirmWipe(false); } };
  const saveName = async () => { try { const r = await api('/me', { method: 'PUT', body: { name } }); setUser(r.user); toast('Profile saved'); } catch (e: any) { toast(e.message, 'bad'); } };
  return (
    <>
      <PageHead title="Profile and shopping memory" sub="The assistant uses only what you approve here." />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card card-pad space-y-4">
          <h2 className="section-title"><UserCircle className="h-4 w-4 text-brand" />Profile</h2>
          <Field label="Name" error={nameErr}><input className={`input ${nameErr ? 'input-error' : ''}`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
          <Field label="Email" hint="Your email is your sign-in and cannot be changed here."><input className="input" value={user?.email} disabled /></Field>
          <button className="btn-primary" disabled={name.trim().length < 2 || name === user?.name} onClick={saveName}><Save className="h-4 w-4" />Save profile</button>
        </section>
        <section className="card card-pad space-y-4">
          <h2 className="section-title"><Brain className="h-4 w-4 text-brand" />Shopping preferences</h2>
          <p className="-mt-2 text-xs text-muted">Only what you save here is used by the assistant, and only when memory is switched on in Settings.</p>
          <Field label="Preferred brands (comma separated)"><input className="input" value={p.brands} onChange={(e) => setP({ ...p, brands: e.target.value })} placeholder="Nexa, Orbit" /></Field>
          <Field label="Categories"><input className="input" value={p.categories} onChange={(e) => setP({ ...p, categories: e.target.value })} placeholder="laptops, phones" /></Field>
          <Field label="Preferred specs"><input className="input" value={p.specs} onChange={(e) => setP({ ...p, specs: e.target.value })} placeholder="16 GB RAM, lightweight" /></Field>
          <Field label="Typical maximum budget (₹)" error={budgetErr}><input className={`input ${budgetErr ? 'input-error' : ''}`} type="number" min={0} value={p.maxBudget} onChange={(e) => setP({ ...p, maxBudget: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={saving || !!budgetErr} onClick={savePrefs}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save preferences</button><button className="btn-danger" onClick={() => setConfirmWipe(true)}><Trash2 className="h-4 w-4" />Delete all</button></div>
        </section>
      </div>
      <ConfirmDialog open={confirmWipe} title="Delete shopping memory?" body="This clears your saved brands, categories, specs and budget. Orders and your wishlist are not affected. This cannot be undone." confirmLabel="Delete memory" onCancel={() => setConfirmWipe(false)} onConfirm={wipe} />
      <section className="card card-pad mt-6">
        <h2 className="section-title">Shopping history</h2>
        {hist.loading ? <Spinner /> : !hist.data?.items.length ? <p className="mt-2 text-sm text-muted">Verified purchases will be listed here.</p> : (
          <ul className="mt-3 divide-y divide-line text-sm">{hist.data.items.map((i: any, n: number) => <li key={n} className="flex justify-between py-2"><span>{i.quantity} × {i.name}</span><span className="text-muted">{inr(i.price * i.quantity)} · {date(i.at)}</span></li>)}</ul>
        )}
      </section>
    </>
  );
}

export function Settings() {
  const { user, setUser, toast } = useApp();
  const cfg = useFetch<any>('/config');
  if (!user) return null;
  const save = async (patch: Partial<typeof user.settings>) => {
    try { const r = await api('/me/settings', { method: 'PUT', body: { ...user.settings, ...patch } }); setUser(r.user); }
    catch (e: any) { toast(e.message, 'bad'); }
  };
  const rows = [
    { key: 'aiMemory', title: 'Let the assistant use my shopping memory', hint: 'Saved brands, budget and categories fill gaps in your requests.' },
    { key: 'priceAlerts', title: 'Price alerts', hint: 'Notify me when a watched product changes price.' },
  ] as const;
  return (
    <>
      <PageHead title="Settings" sub="Control what the assistant remembers and which alerts you get." />
      <div className="card divide-y divide-line">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-6 p-5"><div><div className="font-semibold">{r.title}</div><div className="text-sm text-muted">{r.hint}</div></div>
            <Toggle on={(user.settings as any)[r.key]} label={r.title} onChange={(v) => save({ [r.key]: v })} /></div>
        ))}
      </div>
      <section className="card card-pad mt-6 text-sm">
        <h2 className="section-title"><Cpu className="h-4 w-4 text-brand" />Environment</h2>
        {cfg.loading ? <Spinner /> : cfg.data && <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ['PayPal sandbox', cfg.data.paypalConfigured ? 'Credentials set' : 'Credentials missing', cfg.data.paypalConfigured],
            ['Webhook verification', cfg.data.webhookConfigured ? 'Webhook ID set' : 'Webhook ID missing', cfg.data.webhookConfigured],
            ['Agents', cfg.data.ai === 'rules' ? 'Rules mode (no AI key)' : `LLM: ${cfg.data.ai}`, true],
            ['Charge currency', `${cfg.data.currency} at ₹${cfg.data.inrPerUnit} per unit`, true],
          ].map(([k, v, ok]) => (
            <div key={String(k)} className="flex items-start gap-3 rounded-xl bg-paper p-3">
              {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />}
              <div><dt className="text-xs text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>
            </div>
          ))}</dl>}
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted"><ShieldCheck className="h-3.5 w-3.5" />Sandbox mode: no real money moves. The catalog and its images are demo data.</p>
      </section>
    </>
  );
}
