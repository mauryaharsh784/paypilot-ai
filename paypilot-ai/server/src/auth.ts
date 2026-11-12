import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from './config';
import { User } from './models';
import { AppError, h } from './http';

const COOKIE = 'pp_token';
const cookieOpts = () => ({
  httpOnly: true,
  secure: config.env === 'production' || config.cookieSameSite === 'none',
  sameSite: config.cookieSameSite,
  maxAge: 7 * 24 * 3600 * 1000,
  path: '/',
});

export const publicUser = (u: any) => ({
  id: String(u._id), name: u.name, email: u.email, role: u.role,
  preferences: u.preferences, settings: u.settings,
});

function readToken(req: any): { id: string; role: string } | null {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;
  try { return jwt.verify(raw, config.jwtSecret) as any; } catch { return null; }
}

export const requireAuth = (req: any, _res: any, next: any) => {
  const tok = readToken(req);
  if (!tok) return next(new AppError(401, 'Please sign in to continue', 'UNAUTHENTICATED'));
  req.user = { id: tok.id, role: tok.role };
  next();
};

export const requireAdmin = h(async (req, _res, next) => {
  const u = await User.findById(req.user.id).lean();
  if (!u || u.role !== 'admin') throw new AppError(403, 'Admin access required', 'FORBIDDEN');
  next();
});

const issue = (res: any, u: any) => {
  const token = jwt.sign({ id: String(u._id), role: u.role }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie(COOKIE, token, cookieOpts());
};

export const authRouter = Router();

authRouter.post('/register', h(async (req, res) => {
  const b = z.object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().email(),
    password: z.string().min(8).max(100),
  }).parse(req.body);
  if (await User.exists({ email: b.email.toLowerCase() })) throw new AppError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
  const u = await User.create({ name: b.name, email: b.email, passwordHash: await bcrypt.hash(b.password, 11) });
  issue(res, u);
  res.status(201).json({ user: publicUser(u) });
}));

authRouter.post('/login', h(async (req, res) => {
  const b = z.object({ email: z.string().trim().email(), password: z.string().min(1) }).parse(req.body);
  const u = await User.findOne({ email: b.email.toLowerCase() });
  if (!u || !(await bcrypt.compare(b.password, u.passwordHash))) throw new AppError(401, 'Email or password is incorrect', 'BAD_CREDENTIALS');
  issue(res, u);
  res.json({ user: publicUser(u) });
}));

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
  res.json({ ok: true });
});

authRouter.get('/me', h(async (req, res) => {
  const tok = readToken(req);
  const u = tok ? await User.findById(tok.id) : null;
  res.json({ user: u ? publicUser(u) : null });
}));
