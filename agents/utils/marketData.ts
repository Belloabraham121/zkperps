/**
 * Market Data Utilities
 * 
 * Functions for fetching market data from Uniswap v4 pools including:
 * - Current price
 * - Liquidity data
 * - Volume calculations
 * - Price changes over time
 * - Recent swap events
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

export class MarketDataFetcher {
  private provider: ethers.JsonRpcProvider;
  private poolManagerAddress: string;
  private cache: Map<PoolId, MarketDataCache>;
  private defaultCacheTTL: number; // Default cache TTL in milliseconds

  // Uniswap v4 PoolManager ABI
  private readonly POOL_MANAGER_ABI = [
    'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
    'function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity)',
    'function getLiquidityAtTick(bytes32 poolId, int24 tick) external view returns (uint128 liquidity)',
    'event Swap(bytes32 indexed poolId, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
  ];

  constructor(
    provider: ethers.JsonRpcProvider,
    poolManagerAddress: string,
    cacheTTL: number = 30000 // Default 30 seconds
  ) {
    this.provider = provider;
    this.poolManagerAddress = poolManagerAddress;
    this.cache = new Map();
    this.defaultCacheTTL = cacheTTL;
  }

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

    // Fetch fresh data
    const [currentPrice, liquidity, recentSwaps] = await Promise.all([
      this.fetchCurrentPrice(poolId),
      this.fetchLiquidity(poolId),
      this.fetchRecentSwaps(poolId, 10), // Last 10 swaps
    ]);

    // Calculate price changes (simplified - would need historical data for accurate calculation)
    const priceChange1h = await this.calculatePriceChange(poolId, 3600); // 1 hour
    const priceChange24h = await this.calculatePriceChange(poolId, 86400); // 24 hours

    // Calculate volumes
    const volume1h = this.calculateVolume(recentSwaps, 3600);
    const volume24h = this.calculateVolume(recentSwaps, 86400);

    const marketData: MarketData = {
      poolId,
      poolKey,
      currentPrice: currentPrice.toString(),
      priceChange1h,
      priceChange24h,
      totalLiquidity: liquidity.total.toString(),
      liquidity0: liquidity.liquidity0.toString(),
      liquidity1: liquidity.liquidity1.toString(),
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

  /**
   * Fetch current price from pool
   */
  async fetchCurrentPrice(poolId: PoolId): Promise<bigint> {
    try {
      const poolManager = new ethers.Contract(
        this.poolManagerAddress,
        this.POOL_MANAGER_ABI,
        this.provider
      );

      // Convert poolId string to bytes32
      const poolIdBytes32 = ethers.hexlify(ethers.getBytes(poolId));
      
      const result = await poolManager.getSlot0(poolIdBytes32);
      const sqrtPriceX96 = BigInt(result[0].toString());
      
      // Convert sqrtPriceX96 to actual price
      // Price = (sqrtPriceX96 / 2^96)^2
      // For token1/token0: price = (sqrtPriceX96 / 2^96)^2
      const Q96 = BigInt(2) ** BigInt(96);
      const price = (sqrtPriceX96 * sqrtPriceX96) / (Q96 * Q96);
      
      return price;
    } catch (error) {
      console.error(`Error fetching price for pool ${poolId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch liquidity data from pool
   */
  async fetchLiquidity(poolId: PoolId): Promise<{
    total: bigint;
    liquidity0: bigint;
    liquidity1: bigint;
  }> {
    try {
      const poolManager = new ethers.Contract(
        this.poolManagerAddress,
        this.POOL_MANAGER_ABI,
        this.provider
      );

      const poolIdBytes32 = ethers.hexlify(ethers.getBytes(poolId));
      
      // Get total liquidity
      const liquidity = await poolManager.getLiquidity(poolIdBytes32);
      
      // For simplicity, we'll estimate liquidity0 and liquidity1 as equal
      // In a real implementation, you'd need to calculate based on current price
      const liquidity0 = liquidity / BigInt(2);
      const liquidity1 = liquidity / BigInt(2);

      return {
        total: liquidity,
        liquidity0,
        liquidity1,
      };
    } catch (error) {
      console.error(`Error fetching liquidity for pool ${poolId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch recent swap events
   */
  async fetchRecentSwaps(poolId: PoolId, limit: number = 10): Promise<SwapEvent[]> {
    try {
      const poolManager = new ethers.Contract(
        this.poolManagerAddress,
        this.POOL_MANAGER_ABI,
        this.provider
      );

      const poolIdBytes32 = ethers.hexlify(ethers.getBytes(poolId));
      
      // Get swap events from the last 24 hours
      const fromBlock = await this.provider.getBlockNumber() - 10000; // Approximate last 24h
      const toBlock = 'latest';

      const filter = poolManager.filters.Swap(poolIdBytes32);
      const events = await poolManager.queryFilter(filter, fromBlock, toBlock);

      // Sort by block number (most recent first) and limit
      const recentEvents = events
        .slice(-limit)
        .reverse()
        .map((event) => {
          if (!('args' in event) || !event.args) {
            throw new Error('Event missing args');
          }
          const args = event.args as any;
          return {
            poolId,
            timestamp: event.blockNumber, // Will be converted to actual timestamp if needed
            amount0: args.amount0.toString(),
            amount1: args.amount1.toString(),
            zeroForOne: args.amount0 < 0, // Negative amount0 means zeroForOne
            sqrtPriceX96: args.sqrtPriceX96.toString(),
          } as SwapEvent;
        });

      // Get actual timestamps for events
      const eventsWithTimestamps = await Promise.all(
        recentEvents.map(async (event) => {
          const block = await this.provider.getBlock(Number(event.timestamp));
          return {
            ...event,
            timestamp: block?.timestamp || Math.floor(Date.now() / 1000),
          };
        })
      );

      return eventsWithTimestamps;
    } catch (error) {
      console.error(`Error fetching recent swaps for pool ${poolId}:`, error);
      // Return empty array on error rather than throwing
      return [];
    }
  }

  /**
   * Calculate price change over a time period
   * Note: This is a simplified implementation. For accurate calculations,
   * you'd need to store historical price data.
   */
  async calculatePriceChange(_poolId: PoolId, _timeWindowSeconds: number): Promise<number> {
    try {
      // For now, return 0 as we don't have historical data storage
      // In a production system, you'd query historical prices from a database
      // or use a price oracle
      // TODO: Implement historical price tracking
      return 0;
    } catch (error) {
      console.error(`Error calculating price change for pool ${_poolId}:`, error);
      return 0;
    }
  }

  /**
   * Calculate volume from swap events over a time period
   */
  calculateVolume(swaps: SwapEvent[], timeWindowSeconds: number): bigint {
    const now = Date.now() / 1000;
    const cutoffTime = now - timeWindowSeconds;

    let totalVolume = BigInt(0);

    for (const swap of swaps) {
      if (swap.timestamp >= cutoffTime) {
        // Add absolute value of both amounts
        const amount0 = BigInt(swap.amount0);
        const amount1 = BigInt(swap.amount1);
        totalVolume += (amount0 < 0 ? -amount0 : amount0) + (amount1 < 0 ? -amount1 : amount1);
      }
    }

    return totalVolume;
  }

  /**
   * Get pool ID from pool key (matches TradingAgent implementation)
   */
  private getPoolId(pool: PoolKey): PoolId {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [pool.currency0, pool.currency1, pool.fee, pool.tickSpacing, pool.hooks]
    );
    return ethers.keccak256(encoded);
  }

  /**
   * Clear cache for a specific pool
   */
  clearCache(poolId: PoolId): void {
    this.cache.delete(poolId);
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    this.cache.clear();
  }

  /**
   * Set cache TTL for a specific pool
   */
  setCacheTTL(poolId: PoolId, ttl: number): void {
    const cached = this.cache.get(poolId);
    if (cached) {
      cached.ttl = ttl;
    }
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
