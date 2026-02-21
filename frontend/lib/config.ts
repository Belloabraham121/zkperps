/**
 * Frontend configuration constants
 */

// Default market ID (ETH/USD perp)
export const DEFAULT_MARKET_ID = "0x0000000000000000000000000000000000000001";

// Default pool key (can be overridden). Must have currency0 < currency1 by address (Uniswap V4).
export const DEFAULT_POOL_KEY = {
  currency0: "0x3c604069c87256bbab9cc3ff678410275b156755", // USDT (lower address)
  currency1: "0x3cbe896e5e4093d6bf8dc0dc7a44c50552c0651e", // USDC
  fee: 3000,
  tickSpacing: 60,
  hooks: "0xe3ea87fb759c3206a9595048732eb6a6000700c4", // PrivBatchHook
};
