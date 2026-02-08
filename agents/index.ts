/**
 * Main entry point for the agents module
 */

// Core
export { TradingAgent } from './TradingAgent';
export { AgentManager } from './AgentManager';
export type { AgentRegistration, BatchExecutionState } from './AgentManager';

// Strategies
export { BaseStrategy } from './strategies/BaseStrategy';
export type { MarketDataValidation } from './strategies/BaseStrategy';
export { MomentumAgent } from './strategies/MomentumAgent';
export type { MomentumConfig } from './strategies/MomentumAgent';
export { ArbitrageAgent } from './strategies/ArbitrageAgent';
export type { ArbitrageConfig, ReferencePrice } from './strategies/ArbitrageAgent';
export { LiquidityAgent } from './strategies/LiquidityAgent';
export type { LiquidityConfig } from './strategies/LiquidityAgent';
export { MeanReversionAgent } from './strategies/MeanReversionAgent';
export type { MeanReversionConfig } from './strategies/MeanReversionAgent';

// Hook Integration
export { PrivBatchHookClient, PRIV_BATCH_HOOK_ABI } from './hooks/PrivBatchHookClient';
export type { ZKProof, TransactionResult, HookClientConfig } from './hooks/PrivBatchHookClient';
export { RevealManager } from './hooks/RevealManager';
export type { RevealData, RevealValidation, RevealSubmissionResult } from './hooks/RevealManager';
export { BatchExecutor } from './hooks/BatchExecutor';
export type { BatchReadiness, BatchExecutionResult, BatchExecutorConfig } from './hooks/BatchExecutor';
export { TokenDistributionHandler } from './hooks/TokenDistributionHandler';
export type { DistributionEvent, AgentBalance, DistributionStats } from './hooks/TokenDistributionHandler';

// Configuration & Lifecycle
export {
  createAgentConfig,
  validateAgentConfig,
  loadConfigFromEnv,
  loadConfigFromFile,
  createPoolKey,
  printConfigSummary,
  DEFAULT_AGENT_CONFIG,
} from './config/agentConfig';
export type { ConfigValidationResult, CreateAgentConfigOptions } from './config/agentConfig';
export { AgentLifecycleManager } from './config/AgentLifecycleManager';
export type {
  LifecycleEvent,
  LifecycleLogEntry,
  AgentHealthReport,
  LifecycleManagerConfig,
} from './config/AgentLifecycleManager';

// Coordination
export { BatchCoordinator } from './coordination/BatchCoordinator';
export type {
  AgentReadinessSignal,
  BatchParameters,
  ConflictResolution,
  BatchCoordinatorConfig,
  BatchReadyCallback,
} from './coordination/BatchCoordinator';
export { AgentMessageBus } from './coordination/AgentMessageBus';
export { MessageTopic } from './coordination/AgentMessageBus';
export type {
  AgentMessage,
  MessageHandler,
  SharedStateEntry,
  MessageBusConfig,
} from './coordination/AgentMessageBus';

// Types
export * from './types';

// Utilities
export { MarketDataFetcher, createMarketDataFetcher } from './utils/marketData';
export { PoolMonitor, createPoolMonitor } from './utils/poolMonitor';
