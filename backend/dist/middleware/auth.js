import jwt from "jsonwebtoken";
import { config } from "../config.js";
export function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
        res.status(401).json({ error: "Missing or invalid Authorization header" });
        return;
    }
    try {
        const decoded = jwt.verify(token, config.jwtSecret);
        req.user = decoded;
        next();
    }
    catch {
        res.status(401).json({ error: "Invalid or expired token" });
    }
}
export function createToken(payload) {
    return jwt.sign(payload, config.jwtSecret, {
        expiresIn: config.jwtExpiresIn,
        // Note: Don't set 'subject' option - payload already has 'sub' property
    });
}
//# sourceMappingURL=auth.js.map