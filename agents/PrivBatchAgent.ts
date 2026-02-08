/**
 * PrivBatchAgent - Concrete TradingAgent implementation
 *
 * Wires together:
 * - MarketDataFetcher for on-chain pool data
 * - Any TradingStrategy (Momentum, Arbitrage, Liquidity, MeanReversion)
 * - PrivBatchHookClient for commitment submission & batch execution
 *
 * This is the runnable agent class. Use it directly or register it
 * with AgentManager for multi-agent orchestration.
 */

import { TradingAgent } from './TradingAgent';
import {
  AgentConfig,
  MarketData,
  PoolKey,
  TradingStrategy,
} from './types/interfaces';
import { MarketDataFetcher } from './utils/marketData';

export class PrivBatchAgent extends TradingAgent {
  private marketDataFetcher: MarketDataFetcher;

  constructor(config: AgentConfig, strategy: TradingStrategy) {
    super(config, strategy);

    // Create the market data fetcher using the same provider
    this.marketDataFetcher = new MarketDataFetcher(
      this.provider,
      config.poolManagerAddress,
      config.monitoringSettings.pollInterval // cache TTL = poll interval
    );
  }

  /**
   * Fetch market data for a pool using the on-chain MarketDataFetcher
   */
  protected async fetchMarketData(pool: PoolKey): Promise<MarketData> {
    return this.marketDataFetcher.fetchMarketData(pool);
  }

  /**
   * Get the underlying market data fetcher (useful for external integrations)
   */
  getMarketDataFetcher(): MarketDataFetcher {
    return this.marketDataFetcher;
  }
}
