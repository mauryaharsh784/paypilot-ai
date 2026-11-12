import { create } from 'zustand';
import { api } from './lib/api';

export type User = { id: string; name: string; email: string; role: 'user' | 'admin'; preferences: any; settings: { aiMemory: boolean; priceAlerts: boolean } };
type Toast = { id: number; text: string; tone: 'ok' | 'bad' };

type State = {
  user: User | null; ready: boolean; cartCount: number; unread: number; compare: string[]; toasts: Toast[];
  init: () => Promise<void>; setUser: (u: User | null) => void; refresh: () => Promise<void>; logout: () => Promise<void>;
  toggleCompare: (id: string) => void; clearCompare: () => void; toast: (text: string, tone?: 'ok' | 'bad') => void;
};

export const useApp = create<State>((set, get) => ({
  user: null, ready: false, cartCount: 0, unread: 0, compare: [], toasts: [],
  async init() {
    try { const { user } = await api('/auth/me'); set({ user }); if (user) await get().refresh(); } catch { /* signed out */ }
    set({ ready: true });
  },
  setUser: (user) => set({ user }),
  async refresh() { try { const c = await api('/me/counts'); set({ cartCount: c.cart, unread: c.unread }); } catch { /* ignore */ } },
  async logout() { await api('/auth/logout', { method: 'POST', body: {} }); set({ user: null, cartCount: 0, unread: 0, compare: [] }); },
  toggleCompare: (id) => set((s) => ({ compare: s.compare.includes(id) ? s.compare.filter((x) => x !== id) : [...s.compare, id].slice(-3) })),
  clearCompare: () => set({ compare: [] }),
  toast(text, tone = 'ok') {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  },
}));
