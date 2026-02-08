/**
 * Market Data Utilities
 *
 * Functions for fetching market data from Uniswap v4 pools including:
 * - Current price (via extsload → StateLibrary layout)
 * - Liquidity data
 * - Volume calculations
 * - Price changes over time
 * - Recent swap events
 *
 * V4 reads state via `extsload` on the PoolManager.
 * See contracts/lib/v4-core/src/libraries/StateLibrary.sol
 */

import { ethers } from 'ethers';
import {
  PoolKey,
  PoolId,
  MarketData,
  SwapEvent,
} from '../types/interfaces';

export interface MarketDataCache {
  data: MarketData;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

// ─── Constants (matches StateLibrary.sol) ─────────────────────
const POOLS_SLOT = '0x0000000000000000000000000000000000000000000000000000000000000006';
const LIQUIDITY_OFFSET = 3;

export class MarketDataFetcher {
  protected provider: ethers.JsonRpcProvider;
  protected poolManagerAddress: string;
  private cache: Map<PoolId, MarketDataCache>;
  private defaultCacheTTL: number;

  // PoolManager ABI – only the functions we actually need
  private readonly POOL_MANAGER_ABI = [
    // extsload: read a single storage slot
    'function extsload(bytes32 slot) external view returns (bytes32)',
    // extsload: read N contiguous slots
    'function extsload(bytes32 startSlot, uint256 nSlots) external view returns (bytes32[])',
    // Events
    'event Swap(bytes32 indexed poolId, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
  ];

  constructor(
    provider: ethers.JsonRpcProvider,
    poolManagerAddress: string,
    cacheTTL: number = 30000
  ) {
    this.provider = provider;
    this.poolManagerAddress = poolManagerAddress;
    this.cache = new Map();
    this.defaultCacheTTL = cacheTTL;
  }

  // ─── Public API ──────────────────────────────────────────────

  /**
   * Fetch complete market data for a pool
   */
  async fetchMarketData(poolKey: PoolKey): Promise<MarketData> {
    const poolId = this.getPoolId(poolKey);

    // Check cache first
    const cached = this.cache.get(poolId);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data;
    }

    // Fetch fresh data — individual failures return fallback values
    const [slot0, liquidity, recentSwaps] = await Promise.all([
      this.fetchSlot0(poolId).catch(() => null),
      this.fetchLiquidity(poolId).catch(() => 0n),
      this.fetchRecentSwaps(poolId, 10).catch(() => []),
    ]);

    const sqrtPriceX96 = slot0?.sqrtPriceX96 ?? 0n;

    // Derive human-readable price from sqrtPriceX96
    const currentPrice = this.sqrtPriceX96ToPrice(sqrtPriceX96);

    // Price changes (would require historical data – simplified for now)
    const priceChange1h = await this.calculatePriceChange(poolId, 3600);
    const priceChange24h = await this.calculatePriceChange(poolId, 86400);

    // Volumes
    const volume1h = this.calculateVolume(recentSwaps, 3600);
    const volume24h = this.calculateVolume(recentSwaps, 86400);

    // Estimate per-side liquidity (equal split — real impl would use ticks)
    const liq0 = liquidity / 2n;
    const liq1 = liquidity - liq0;

    const marketData: MarketData = {
      poolId,
      poolKey,
      currentPrice: currentPrice.toString(),
      priceChange1h,
      priceChange24h,
      totalLiquidity: liquidity.toString(),
      liquidity0: liq0.toString(),
      liquidity1: liq1.toString(),
      volume1h: volume1h.toString(),
      volume24h: volume24h.toString(),
      recentSwaps,
      timestamp: Date.now(),
    };

    // Cache the data
    this.cache.set(poolId, {
      data: marketData,
      timestamp: Date.now(),
      ttl: this.defaultCacheTTL,
    });

    return marketData;
  }

  // ─── V4 extsload reads (replicates StateLibrary.sol) ─────────

  /**
   * Read Slot0 of a pool via extsload.
   * Layout (packed in a single bytes32):
   *   [232..255] lpFee        (24 bits)
   *   [208..231] protocolFee  (24 bits)
   *   [160..207] tick         (24 bits, signed)
   *   [  0..159] sqrtPriceX96 (160 bits)
   */
  async fetchSlot0(poolId: PoolId): Promise<{
    sqrtPriceX96: bigint;
    tick: number;
    protocolFee: number;
    lpFee: number;
  }> {
    const poolManager = new ethers.Contract(
      this.poolManagerAddress,
      this.POOL_MANAGER_ABI,
      this.provider
    );

    const stateSlot = this.getPoolStateSlot(poolId);
    const raw: string = await poolManager.extsload(stateSlot);
    const data = BigInt(raw);

    // Extract packed fields
    const sqrtPriceX96 = data & ((1n << 160n) - 1n);

    // tick is 24-bit signed — sign extend
    let tickRaw = Number((data >> 160n) & 0xFFFFFFn);
    if (tickRaw >= 0x800000) tickRaw -= 0x1000000; // sign extend 24-bit

    const protocolFee = Number((data >> 184n) & 0xFFFFFFn);
    const lpFee = Number((data >> 208n) & 0xFFFFFFn);

    return { sqrtPriceX96, tick: tickRaw, protocolFee, lpFee };
  }

  /**
   * Read total liquidity of a pool via extsload.
   * Liquidity is at offset 3 from the pool state slot.
   */
  async fetchLiquidity(poolId: PoolId): Promise<bigint> {
    const poolManager = new ethers.Contract(
      this.poolManagerAddress,
      this.POOL_MANAGER_ABI,
      this.provider
    );

    const stateSlot = this.getPoolStateSlot(poolId);
    const liquiditySlot = BigInt(stateSlot) + BigInt(LIQUIDITY_OFFSET);
    const slotHex = '0x' + liquiditySlot.toString(16).padStart(64, '0');

    const raw: string = await poolManager.extsload(slotHex);
    // Liquidity is uint128 — take bottom 128 bits
    return BigInt(raw) & ((1n << 128n) - 1n);
  }

  /**
   * Fetch recent swap events (limited block range for free-tier RPC)
   */
  async fetchRecentSwaps(poolId: PoolId, limit: number = 10): Promise<SwapEvent[]> {
    try {
      const poolManager = new ethers.Contract(
        this.poolManagerAddress,
        this.POOL_MANAGER_ABI,
        this.provider
      );

      const poolIdBytes32 = ethers.zeroPadValue(poolId, 32);

      // Use a small block range to stay within free-tier limits (10 blocks)
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 9);

      const filter = poolManager.filters.Swap(poolIdBytes32);
      const events = await poolManager.queryFilter(filter, fromBlock, currentBlock);

      // Sort by block number (most recent first) and limit
      const recentEvents = events
        .slice(-limit)
        .reverse()
        .map((event) => {
          if (!('args' in event) || !event.args) {
            throw new Error('Event missing args');
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const args = event.args as any;
          return {
            poolId,
            timestamp: event.blockNumber,
            amount0: args.amount0.toString(),
            amount1: args.amount1.toString(),
            zeroForOne: args.amount0 < 0,
            sqrtPriceX96: args.sqrtPriceX96.toString(),
          } as SwapEvent;
        });

      // Fetch actual timestamps (batch friendly)
      const eventsWithTimestamps = await Promise.all(
        recentEvents.map(async (event) => {
          try {
            const block = await this.provider.getBlock(Number(event.timestamp));
            return {
              ...event,
              timestamp: block?.timestamp || Math.floor(Date.now() / 1000),
            };
          } catch {
            return { ...event, timestamp: Math.floor(Date.now() / 1000) };
          }
        })
      );

      return eventsWithTimestamps;
    } catch (error) {
      // Log once, return empty — the monitoring loop will retry
      console.warn(`[MarketData] Could not fetch recent swaps for pool ${poolId.slice(0, 10)}...`);
      return [];
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────

  /**
   * Compute pool state storage slot (matches StateLibrary._getPoolStateSlot)
   * `keccak256(abi.encodePacked(poolId, POOLS_SLOT))`
   */
  private getPoolStateSlot(poolId: PoolId): string {
    // abi.encodePacked(bytes32 poolId, bytes32 POOLS_SLOT) = just concatenate
    const packed = ethers.concat([
      ethers.zeroPadValue(poolId, 32),
      POOLS_SLOT,
    ]);
    return ethers.keccak256(packed);
  }

  /**
   * Convert sqrtPriceX96 to a human-readable price string.
   * price = (sqrtPriceX96 / 2^96)^2
   */
  private sqrtPriceX96ToPrice(sqrtPriceX96: bigint): string {
    if (sqrtPriceX96 === 0n) return '0';

    // Use floating point for display
    const Q96 = 2 ** 96;
    const sqrtPrice = Number(sqrtPriceX96) / Q96;
    const price = sqrtPrice * sqrtPrice;

    // Return with reasonable precision
    return price.toPrecision(8);
  }

  /**
   * Calculate price change over a time period.
   * Simplified — returns 0 until historical storage is implemented.
   */
  async calculatePriceChange(_poolId: PoolId, _timeWindowSeconds: number): Promise<number> {
    // TODO: Implement historical price tracking (DB or in-memory ring buffer)
    return 0;
  }

  /**
   * Calculate volume from swap events over a time period
   */
  calculateVolume(swaps: SwapEvent[], timeWindowSeconds: number): bigint {
    const now = Date.now() / 1000;
    const cutoffTime = now - timeWindowSeconds;

    let totalVolume = 0n;

    for (const swap of swaps) {
      if (swap.timestamp >= cutoffTime) {
        const amount0 = BigInt(swap.amount0);
        const amount1 = BigInt(swap.amount1);
        totalVolume += (amount0 < 0 ? -amount0 : amount0) + (amount1 < 0 ? -amount1 : amount1);
      }
    }

    return totalVolume;
  }

  /**
   * Get pool ID from pool key
   */
  private getPoolId(pool: PoolKey): PoolId {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [pool.currency0, pool.currency1, pool.fee, pool.tickSpacing, pool.hooks]
    );
    return ethers.keccak256(encoded);
  }

  /** Clear cache for a specific pool */
  clearCache(poolId: PoolId): void {
    this.cache.delete(poolId);
  }

  /** Clear all cache */
  clearAllCache(): void {
    this.cache.clear();
  }

  /** Set cache TTL for a specific pool */
  setCacheTTL(poolId: PoolId, ttl: number): void {
    const cached = this.cache.get(poolId);
    if (cached) {
      cached.ttl = ttl;
    }
  }

  /** Get the provider instance */
  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  /** Get the pool manager address */
  getPoolManagerAddress(): string {
    return this.poolManagerAddress;
  }
}

/**
 * Helper function to create a MarketDataFetcher instance
 */
export function createMarketDataFetcher(
  rpcUrl: string,
  poolManagerAddress: string,
  cacheTTL?: number
): MarketDataFetcher {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new MarketDataFetcher(provider, poolManagerAddress, cacheTTL);
}
