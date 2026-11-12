import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';

export class AppError extends Error {
  constructor(public status: number, message: string, public code?: string, public data?: any) {
    super(message);
  }
}
export const h = (fn: (req: any, res: Response, next: NextFunction) => Promise<any>) =>
  (req: any, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };
export const oid = (v: any) => {
  if (!mongoose.isValidObjectId(v)) throw new AppError(400, 'Invalid id', 'BAD_ID');
  return String(v);
};
export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
