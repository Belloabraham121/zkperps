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
    authorizationPrivateKeyPath: process.env.AUTHORIZATION_PRIVATE_KEY_PATH ?? "",
  },

  chainId: parseInt(process.env.CHAIN_ID ?? "421614", 10),
  rpcUrl: process.env.RPC_URL ?? "",
  baseIsCurrency0: process.env.BASE_IS_CURRENCY0 !== "false",

  contracts: {
    privBatchHook: (process.env.PRIV_BATCH_HOOK ?? "0xe3ea87fb759c3206a9595048732eb6a6000700c4") as `0x${string}`,
    perpPositionManager: (process.env.PERP_POSITION_MANAGER ?? "0xf3c9cdbaf6dc303fe302fbf81465de0a057ccf5e") as `0x${string}`,
    mockUsdc: (process.env.MOCK_USDC ?? "0x3cbe896e5e4093d6bf8dc0dc7a44c50552c0651e") as `0x${string}`,
    mockUsdt: (process.env.MOCK_USDT ?? "0x3c604069c87256bbab9cc3ff678410275b156755") as `0x${string}`,
    marketId: (process.env.MARKET_ID ?? "0x0000000000000000000000000000000000000001") as `0x${string}`,
  },

  mongodb: {
    uri: process.env.MONGODB_URI ?? "",
    dbName: process.env.MONGODB_DB_NAME ?? "zkperps",
  },
};
