import "dotenv/config";

export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",

  privy: {
    appId: process.env.PRIVY_APP_ID ?? "",
    appSecret: process.env.PRIVY_APP_SECRET ?? "",
    keyQuorumId: process.env.PRIVY_KEY_QUORUM_ID ?? "",
    /** PEM string from env (for Vercel/serverless). Use this or AUTHORIZATION_PRIVATE_KEY_PATH. */
    authorizationPrivateKey: process.env.AUTHORIZATION_PRIVATE_KEY ?? "",
    authorizationPrivateKeyPath:
      process.env.AUTHORIZATION_PRIVATE_KEY_PATH ?? "",
  },

  chainId: parseInt(process.env.CHAIN_ID ?? "421614", 10),
  rpcUrl: process.env.RPC_URL ?? "",
  baseIsCurrency0: process.env.BASE_IS_CURRENCY0 !== "false",

  contracts: {
    /** Uniswap V4 PoolManager (Arbitrum Sepolia); used to read pool slot0 for debug. */
    poolManager: (process.env.POOL_MANAGER ??
      "0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317") as `0x${string}`,
    privBatchHook: (process.env.PRIV_BATCH_HOOK ??
      "0xe3ea87fb759c3206a9595048732eb6a6000700c4") as `0x${string}`,
    perpPositionManager: (process.env.PERP_POSITION_MANAGER ??
      "0xf3c9cdbaf6dc303fe302fbf81465de0a057ccf5e") as `0x${string}`,
    mockUsdc: (process.env.MOCK_USDC ??
      "0x3cbe896e5e4093d6bf8dc0dc7a44c50552c0651e") as `0x${string}`,
    mockUsdt: (process.env.MOCK_USDT ??
      "0x3c604069c87256bbab9cc3ff678410275b156755") as `0x${string}`,
    marketId: (process.env.MARKET_ID ??
      "0x0000000000000000000000000000000000000001") as `0x${string}`,
  },

  mongodb: {
    uri: process.env.MONGODB_URI ?? "",
    dbName: process.env.MONGODB_DB_NAME ?? "zkperps",
  },

  /** Optional. If set, a background keeper will auto-execute perp batches when ready. */
  keeper: {
    /** Privy user ID (e.g. did:privy:...) of the wallet that sends execute-batch txs. Must have wallet linked and addSigners done. */
    privyUserId: process.env.KEEPER_PRIVY_USER_ID ?? "",
    /** How often to check (ms). Default 60_000 (1 min). */
    intervalMs: parseInt(process.env.KEEPER_INTERVAL_MS ?? "60000", 10),
    /** Max commitments per batch (0 = no limit). Use e.g. 2 to test; contract may revert with large batches (e.g. InsufficientMargin on one intent). */
    maxPerpBatchSize: parseInt(process.env.KEEPER_MAX_PERP_BATCH_SIZE ?? "0", 10),
  },
};
