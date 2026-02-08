/**
 * Pool Monitor Utilities
 * 
 * Provides continuous monitoring of Uniswap v4 pools with:
 * - Event listeners for pool state changes
 * - Periodic polling for pool data
 * - Support for multiple pools
 * - Error handling and recovery
 */

import { ethers } from 'ethers';
import {
  PoolKey,
  PoolId,
  MarketData,
} from '../types/interfaces';
import { MarketDataFetcher } from './marketData';

export interface PoolMonitorConfig {
  pollInterval: number; // Polling interval in milliseconds
  maxRetries: number; // Maximum retries for failed operations
  retryDelay: number; // Delay between retries in milliseconds
  enableEventListeners: boolean; // Whether to enable event listeners
}

export interface PoolMonitorCallbacks {
  onMarketDataUpdate?: (poolId: PoolId, marketData: MarketData) => void;
  onError?: (poolId: PoolId, error: Error) => void;
  onPoolStateChange?: (poolId: PoolId, event: any) => void;
}

export class PoolMonitor {
  private marketDataFetcher: MarketDataFetcher;
  private provider: ethers.JsonRpcProvider;
  private pools: Map<PoolId, PoolKey>; // poolId -> PoolKey
  private monitoringIntervals: Map<PoolId, ReturnType<typeof setInterval>>;
  private eventListeners: Map<PoolId, ethers.ContractEventPayload[]>; // poolId -> listeners
  private config: PoolMonitorConfig;
  private callbacks: PoolMonitorCallbacks;
  private isRunning: boolean;
  private retryCounters: Map<PoolId, number>; // poolId -> retry count

  // Uniswap v4 PoolManager ABI for events
  private readonly POOL_MANAGER_ABI = [
    'event Swap(bytes32 indexed poolId, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
    'event ModifyLiquidity(bytes32 indexed poolId, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta)',
  ];

  constructor(
    marketDataFetcher: MarketDataFetcher,
    config: Partial<PoolMonitorConfig> = {},
    callbacks: PoolMonitorCallbacks = {}
  ) {
    this.marketDataFetcher = marketDataFetcher;
    this.provider = marketDataFetcher.getProvider();
    this.pools = new Map();
    this.monitoringIntervals = new Map();
    this.eventListeners = new Map();
    this.retryCounters = new Map();

    this.config = {
      pollInterval: config.pollInterval || 30000, // Default 30 seconds
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 5000, // Default 5 seconds
      enableEventListeners: config.enableEventListeners !== false, // Default true
    };

    this.callbacks = callbacks;
    this.isRunning = false;
  }

  /**
   * Add a pool to monitor
   */
  addPool(poolKey: PoolKey): void {
    const poolId = this.getPoolId(poolKey);
    
    if (this.pools.has(poolId)) {
      console.warn(`[PoolMonitor] Pool ${poolId} is already being monitored`);
      return;
    }

    this.pools.set(poolId, poolKey);
    this.retryCounters.set(poolId, 0);

    console.log(`[PoolMonitor] Added pool ${poolId} to monitoring`);

    // If already running, start monitoring this pool
    if (this.isRunning) {
      this.startMonitoringPool(poolId);
    }
  }

  /**
   * Remove a pool from monitoring
   */
  removePool(poolId: PoolId): void {
    if (!this.pools.has(poolId)) {
      console.warn(`[PoolMonitor] Pool ${poolId} is not being monitored`);
      return;
    }

    // Stop monitoring
    this.stopMonitoringPool(poolId);

    // Remove from pools
    this.pools.delete(poolId);
    this.retryCounters.delete(poolId);

    console.log(`[PoolMonitor] Removed pool ${poolId} from monitoring`);
  }

  /**
   * Start monitoring all pools
   */
  start(): void {
    if (this.isRunning) {
      console.warn('[PoolMonitor] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[PoolMonitor] Starting pool monitoring...');

    // Start monitoring each pool
    for (const poolId of this.pools.keys()) {
      this.startMonitoringPool(poolId);
    }

    console.log(`[PoolMonitor] Started monitoring ${this.pools.size} pools`);
  }

  /**
   * Stop monitoring all pools
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    console.log('[PoolMonitor] Stopping pool monitoring...');

    // Stop monitoring each pool
    for (const poolId of this.pools.keys()) {
      this.stopMonitoringPool(poolId);
    }

    console.log('[PoolMonitor] Stopped monitoring all pools');
  }

  /**
   * Start monitoring a specific pool
   */
  private startMonitoringPool(poolId: PoolId): void {
    const poolKey = this.pools.get(poolId);
    if (!poolKey) {
      return;
    }

    // Stop existing monitoring if any
    this.stopMonitoringPool(poolId);

    // Start periodic polling
    this.startPolling(poolId, poolKey);

    // Start event listeners if enabled
    if (this.config.enableEventListeners) {
      this.startEventListeners(poolId);
    }
  }

  /**
   * Stop monitoring a specific pool
   */
  private stopMonitoringPool(poolId: PoolId): void {
    // Clear polling interval
    const interval = this.monitoringIntervals.get(poolId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(poolId);
    }

    // Remove event listeners
    const listeners = this.eventListeners.get(poolId);
    if (listeners) {
      for (const listener of listeners) {
        listener.removeListener();
      }
      this.eventListeners.delete(poolId);
    }
  }

  /**
   * Start periodic polling for a pool
   */
  private startPolling(poolId: PoolId, poolKey: PoolKey): void {
    // Initial poll
    this.pollPool(poolId, poolKey).catch((error) => {
      console.error(`[PoolMonitor] Error in initial poll for pool ${poolId}:`, error);
      this.handleError(poolId, error as Error);
    });

    // Set up periodic polling
    const interval = setInterval(() => {
      this.pollPool(poolId, poolKey).catch((error) => {
        console.error(`[PoolMonitor] Error polling pool ${poolId}:`, error);
        this.handleError(poolId, error as Error);
      });
    }, this.config.pollInterval);

    this.monitoringIntervals.set(poolId, interval);
  }

  /**
   * Poll a pool for market data
   */
  private async pollPool(poolId: PoolId, poolKey: PoolKey): Promise<void> {
    try {
      const marketData = await this.marketDataFetcher.fetchMarketData(poolKey);
      
      // Reset retry counter on success
      this.retryCounters.set(poolId, 0);

      // Call callback if provided
      if (this.callbacks.onMarketDataUpdate) {
        this.callbacks.onMarketDataUpdate(poolId, marketData);
      }
    } catch (error) {
      throw error; // Let the caller handle retries
    }
  }

  /**
   * Start event listeners for a pool
   */
  private startEventListeners(poolId: PoolId): void {
    try {
      const poolManagerAddress = this.marketDataFetcher.getPoolManagerAddress();
      const poolManager = new ethers.Contract(
        poolManagerAddress,
        this.POOL_MANAGER_ABI,
        this.provider
      );

      const poolIdBytes32 = ethers.hexlify(ethers.getBytes(poolId));
      const listeners: ethers.ContractEventPayload[] = [];

      // Listen for Swap events
      const swapFilter = poolManager.filters.Swap(poolIdBytes32);
      const swapListener = (sender: string, amount0: bigint, amount1: bigint, sqrtPriceX96: bigint, liquidity: bigint, tick: number) => {
        if (this.callbacks.onPoolStateChange) {
          this.callbacks.onPoolStateChange(poolId, {
            type: 'Swap',
            sender,
            amount0: amount0.toString(),
            amount1: amount1.toString(),
            sqrtPriceX96: sqrtPriceX96.toString(),
            liquidity: liquidity.toString(),
            tick,
          });
        }

        // Trigger market data update on swap
        const poolKey = this.pools.get(poolId);
        if (poolKey) {
          this.pollPool(poolId, poolKey).catch((error) => {
            console.error(`[PoolMonitor] Error polling after swap event:`, error);
          });
        }
      };
      poolManager.on(swapFilter, swapListener);
      listeners.push({ removeListener: () => poolManager.off(swapFilter, swapListener) } as any);

      // Listen for ModifyLiquidity events
      const liquidityFilter = poolManager.filters.ModifyLiquidity(poolIdBytes32);
      const liquidityListener = (sender: string, tickLower: number, tickUpper: number, liquidityDelta: bigint) => {
        if (this.callbacks.onPoolStateChange) {
          this.callbacks.onPoolStateChange(poolId, {
            type: 'ModifyLiquidity',
            sender,
            tickLower,
            tickUpper,
            liquidityDelta: liquidityDelta.toString(),
          });
        }

        // Trigger market data update on liquidity change
        const poolKey = this.pools.get(poolId);
        if (poolKey) {
          this.pollPool(poolId, poolKey).catch((error) => {
            console.error(`[PoolMonitor] Error polling after liquidity event:`, error);
          });
        }
      };
      poolManager.on(liquidityFilter, liquidityListener);
      listeners.push({ removeListener: () => poolManager.off(liquidityFilter, liquidityListener) } as any);

      this.eventListeners.set(poolId, listeners);
      console.log(`[PoolMonitor] Started event listeners for pool ${poolId}`);
    } catch (error) {
      console.error(`[PoolMonitor] Error starting event listeners for pool ${poolId}:`, error);
      // Don't throw - event listeners are optional
    }
  }

  /**
   * Handle errors with retry logic
   */
  private handleError(poolId: PoolId, error: Error): void {
    const retryCount = this.retryCounters.get(poolId) || 0;

    // Call error callback
    if (this.callbacks.onError) {
      this.callbacks.onError(poolId, error);
    }

    // Check if we should retry
    if (retryCount >= this.config.maxRetries) {
      console.error(
        `[PoolMonitor] Pool ${poolId} exceeded max retries (${this.config.maxRetries}). Stopping monitoring.`
      );
      this.removePool(poolId);
      return;
    }

    // Increment retry counter
    this.retryCounters.set(poolId, retryCount + 1);

    // Retry after delay
    setTimeout(() => {
      const poolKey = this.pools.get(poolId);
      if (poolKey) {
        console.log(`[PoolMonitor] Retrying pool ${poolId} (attempt ${retryCount + 1}/${this.config.maxRetries})`);
        this.pollPool(poolId, poolKey).catch((retryError) => {
          this.handleError(poolId, retryError as Error);
        });
      }
    }, this.config.retryDelay);
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

  /**
   * Get all monitored pools
   */
  getMonitoredPools(): PoolId[] {
    return Array.from(this.pools.keys());
  }

  /**
   * Check if a pool is being monitored
   */
  isMonitoring(poolId: PoolId): boolean {
    return this.pools.has(poolId);
  }

  /**
   * Get monitoring status
   */
  isMonitorRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Manually trigger a poll for a specific pool
   */
  async triggerPoll(poolId: PoolId): Promise<MarketData | null> {
    const poolKey = this.pools.get(poolId);
    if (!poolKey) {
      throw new Error(`Pool ${poolId} is not being monitored`);
    }

    try {
      return await this.marketDataFetcher.fetchMarketData(poolKey);
    } catch (error) {
      console.error(`[PoolMonitor] Error in manual poll for pool ${poolId}:`, error);
      throw error;
    }
  }
}

/**
 * Helper function to create a PoolMonitor instance
 */
export function createPoolMonitor(
  marketDataFetcher: MarketDataFetcher,
  config?: Partial<PoolMonitorConfig>,
  callbacks?: PoolMonitorCallbacks
): PoolMonitor {
  return new PoolMonitor(marketDataFetcher, config, callbacks);
}
