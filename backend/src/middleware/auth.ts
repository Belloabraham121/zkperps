import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type ms from "ms";
import { config } from "../config.js";

export interface JwtPayload {
  sub: string; // privy user id
  email?: string;
  walletAddress?: string;
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function createToken(payload: Omit<JwtPayload, "iat" | "exp">): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as ms.StringValue,
    // Note: Don't set 'subject' option - payload already has 'sub' property
  });
}
