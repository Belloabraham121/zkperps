import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { connectDB } from "./lib/db.js";
import { authRouter } from "./routes/auth.js";
import { tradeRouter } from "./routes/trade.js";
import { perpRouter } from "./routes/perp.js";
const isVercel = process.env.VERCEL === "1";
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
// On Vercel, connect to MongoDB on first request (serverless has no long-running process)
if (isVercel && config.mongodb.uri) {
    app.use((_req, res, next) => {
        connectDB().then(() => next()).catch(next);
    });
}
app.use("/api/auth", authRouter);
app.use("/api/trade", tradeRouter);
app.use("/api/perp", perpRouter);
app.get("/health", (_req, res) => {
    res.json({ ok: true });
});
// Start server only when not on Vercel (Vercel runs this file as a serverless function)
async function startServer() {
    try {
        if (config.mongodb.uri) {
            await connectDB();
        }
        else {
            console.warn("[MongoDB] MONGODB_URI not set, using in-memory storage (not recommended for production)");
        }
        app.listen(config.port, () => {
            const base = `http://localhost:${config.port}`;
            console.log("");
            console.log("========================================");
            console.log("  Backend server started");
            console.log("========================================");
            console.log(`  URL:        ${base}`);
            console.log(`  Env:        ${config.nodeEnv}`);
            console.log(`  Port:       ${config.port}`);
            console.log("----------------------------------------");
            console.log("  Routes:");
            console.log(`    GET  ${base}/health`);
            console.log(`    *    ${base}/api/auth/*`);
            console.log(`    *    ${base}/api/trade/*`);
            console.log(`    *    ${base}/api/perp/*`);
            console.log("----------------------------------------");
            console.log("  Config:");
            console.log(`    Chain ID:  ${config.chainId}`);
            console.log(`    RPC URL:   ${config.rpcUrl ? "[set]" : "[not set]"}`);
            console.log(`    Privy:     ${config.privy.appId ? "configured" : "not configured"}`);
            console.log(`    JWT:       expires in ${config.jwtExpiresIn}`);
            console.log("========================================");
            console.log("");
        });
    }
    catch (error) {
        console.error("[Server] Failed to start:", error);
        process.exit(1);
    }
}
if (!isVercel) {
    startServer();
}
export default app;
//# sourceMappingURL=index.js.map