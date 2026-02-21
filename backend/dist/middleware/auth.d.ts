import { Request, Response, NextFunction } from "express";
export interface JwtPayload {
    sub: string;
    email?: string;
    walletAddress?: string;
    iat?: number;
    exp?: number;
}
export interface AuthRequest extends Request {
    user?: JwtPayload;
}
export declare function authenticate(req: AuthRequest, res: Response, next: NextFunction): void;
export declare function createToken(payload: Omit<JwtPayload, "iat" | "exp">): string;
//# sourceMappingURL=auth.d.ts.map