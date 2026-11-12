import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Bot, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../store';
import { Field } from '../components/ui';

function Shell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden bg-navy-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand"><Bot className="h-4 w-4" /></span>PayPilot AI</Link>
        <p className="max-w-sm font-display text-2xl leading-snug">Delegate the research. Keep the final say on every payment.</p>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-muted">{sub}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function useAuthForm(path: string) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { setUser, refresh } = useApp();
  const navigate = useNavigate();
  const submit = async (e: FormEvent, body: any) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const { user } = await api(path, { body }); setUser(user); await refresh(); navigate('/dashboard'); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return { error, busy, submit };
}

export function Login() {
  const user = useApp((s) => s.user);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const { error, busy, submit } = useAuthForm('/auth/login');
  if (user) return <Navigate to="/dashboard" replace />;
  return (
    <Shell title="Welcome back" sub="Sign in to continue shopping with your agents.">
      <form className="space-y-4" onSubmit={(e) => submit(e, { email, password })}>
        <Field label="Email"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Sign in</button>
        <p className="text-center text-sm text-muted">New here? <Link className="font-semibold text-brand" to="/register">Create an account</Link></p>
      </form>
    </Shell>
  );
}

export function Register() {
  const user = useApp((s) => s.user);
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const { error, busy, submit } = useAuthForm('/auth/register');
  if (user) return <Navigate to="/dashboard" replace />;
  return (
    <Shell title="Create your account" sub="It takes a minute. No card details are ever stored here.">
      <form className="space-y-4" onSubmit={(e) => submit(e, { name, email, password })}>
        <Field label="Name"><input className="input" autoComplete="name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password (8+ characters)"><input className="input" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Create account</button>
        <p className="text-center text-sm text-muted">Already registered? <Link className="font-semibold text-brand" to="/login">Sign in</Link></p>
      </form>
    </Shell>
  );
}
