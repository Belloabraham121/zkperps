import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { connectDB } from "./lib/db.js";
import { authRouter } from "./routes/auth.js";
import { tradeRouter } from "./routes/trade.js";
import { perpRouter } from "./routes/perp.js";
import { startPerpBatchKeeper } from "./lib/keeper.js";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/trade", tradeRouter);
app.use("/api/perp", perpRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Initialize database connection and start server
async function startServer() {
  try {
    // Connect to MongoDB
    if (config.mongodb.uri) {
      await connectDB();
    } else {
      console.warn("[MongoDB] MONGODB_URI not set, using in-memory storage (not recommended for production)");
    }

    // Start Express server
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
  console.log(`    Keeper:    ${config.keeper.privyUserId ? "enabled (auto execute-batch)" : "disabled (set KEEPER_PRIVY_USER_ID to enable)"}`);
  console.log("========================================");
  console.log("");
      // Auto batch execute (interval-based keeper) — commented out so batches only run on explicit POST /api/perp/execute
      // startPerpBatchKeeper();
    });
  } catch (error) {
    console.error("[Server] Failed to start:", error);
    process.exit(1);
  }
}

startServer();
