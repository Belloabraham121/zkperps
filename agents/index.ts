/**
 * Main entry point for the agents module
 */

export { TradingAgent } from './strategies/TradingAgent';
export { BaseStrategy } from './strategies/BaseStrategy';
export { AgentManager } from './AgentManager';
export type { AgentRegistration, BatchExecutionState } from './AgentManager';
export * from './types';
