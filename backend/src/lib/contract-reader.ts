/**
 * Contract state reader using viem for reading on-chain data.
 * Used for querying positions, collateral, and other view functions.
 */
import { createPublicClient, http, encodePacked, keccak256, type Address, type PublicClient } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { config } from "../config.js";

const { contracts: c, rpcUrl } = config;
// Note: chainId from config is ignored - always uses Arbitrum Sepolia (421614)

// Create public client for reading contract state
// Always uses Arbitrum Sepolia (421614) - hardcoded default
export function getPublicClient(): PublicClient {
  if (!rpcUrl) {
    throw new Error("RPC_URL must be set to read contract state");
  }

  return createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl, {
      timeout: 15_000,
      retryCount: 3,
      retryDelay: 1_000,
    }),
  });
}

const PERP_MANAGER_ABI = [
  {
    name: "getTotalCollateral",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getPosition",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "market", type: "address" },
    ],
    outputs: [
      { name: "size", type: "int256" },
      { name: "entryPrice", type: "uint256" },
      { name: "collateral", type: "uint256" },
      { name: "leverage", type: "uint256" },
      { name: "lastFundingPaid", type: "uint256" },
      { name: "entryCumulativeFunding", type: "int256" },
    ],
  },
  {
    name: "getAvailableMargin",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const HOOK_ABI = [
  {
    name: "computePerpCommitmentHash",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "market", type: "address" },
          { name: "size", type: "uint256" },
          { name: "isLong", type: "bool" },
          { name: "isOpen", type: "bool" },
          { name: "collateral", type: "uint256" },
          { name: "leverage", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "BATCH_INTERVAL",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "perpBatchStates",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "lastBatchTimestamp", type: "uint256" },
      { name: "commitmentCount", type: "uint256" },
    ],
  },
  {
    name: "poolManager",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

/** Uniswap V4 PoolManager extsload(slot) for reading pool slot0 (StateLibrary.POOLS_SLOT = 6) */
const POOL_MANAGER_EXTSLOAD_ABI = [
  {
    name: "extsload",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

/**
 * Get user's total collateral from PerpPositionManager
 */
export async function getTotalCollateral(userAddress: Address): Promise<bigint> {
  const client = getPublicClient();
  const result = await client.readContract({
    address: c.perpPositionManager,
    abi: PERP_MANAGER_ABI,
    functionName: "getTotalCollateral",
    args: [userAddress],
  }) as bigint;
  return result;
}

/**
 * Get user's position for a specific market
 */
export async function getPosition(
  userAddress: Address,
  marketId: Address,
): Promise<{
  size: bigint;
  entryPrice: bigint;
  collateral: bigint;
  leverage: bigint;
  lastFundingPaid: bigint;
  entryCumulativeFunding: bigint;
}> {
  const client = getPublicClient();
  const result = await client.readContract({
    address: c.perpPositionManager,
    abi: PERP_MANAGER_ABI,
    functionName: "getPosition",
    args: [userAddress, marketId],
  }) as [bigint, bigint, bigint, bigint, bigint, bigint];
  
  return {
    size: result[0],
    entryPrice: result[1],
    collateral: result[2],
    leverage: result[3],
    lastFundingPaid: result[4],
    entryCumulativeFunding: result[5],
  };
}

/**
 * Get user's available margin
 */
export async function getAvailableMargin(userAddress: Address): Promise<bigint> {
  const client = getPublicClient();
  const result = await client.readContract({
    address: c.perpPositionManager,
    abi: PERP_MANAGER_ABI,
    functionName: "getAvailableMargin",
    args: [userAddress],
  }) as bigint;
  return result;
}

/**
 * Compute perp commitment hash from intent (read-only call)
 */
export async function computePerpCommitmentHash(intent: {
  user: Address;
  market: Address;
  size: bigint;
  isLong: boolean;
  isOpen: boolean;
  collateral: bigint;
  leverage: bigint;
  nonce: bigint;
  deadline: bigint;
}): Promise<`0x${string}`> {
  const client = getPublicClient();
  const result = await client.readContract({
    address: c.privBatchHook,
    abi: HOOK_ABI,
    functionName: "computePerpCommitmentHash",
    args: [intent],
  });
  return result as `0x${string}`;
}

/**
 * Get batch interval from Hook
 */
export async function getBatchInterval(): Promise<bigint> {
  const client = getPublicClient();
  const result = await client.readContract({
    address: c.privBatchHook,
    abi: HOOK_ABI,
    functionName: "BATCH_INTERVAL",
  }) as bigint;
  return result;
}

/**
 * Get the PoolManager address the Hook uses (set at deploy time).
 * Backend POOL_MANAGER and SetupPoolLiquidity POOL_MANAGER must match this.
 */
export async function getHookPoolManager(): Promise<Address> {
  const client = getPublicClient();
  const result = await client.readContract({
    address: c.privBatchHook,
    abi: HOOK_ABI,
    functionName: "poolManager",
  }) as Address;
  return result;
}

/**
 * Get batch state for a pool
 */
export async function getBatchState(poolId: `0x${string}`): Promise<{
  lastBatchTimestamp: bigint;
  commitmentCount: bigint;
}> {
  const client = getPublicClient();
  const result = await client.readContract({
    address: c.privBatchHook,
    abi: HOOK_ABI,
    functionName: "perpBatchStates",
    args: [poolId],
  }) as [bigint, bigint];
  
  return {
    lastBatchTimestamp: result[0],
    commitmentCount: result[1],
  };
}

/**
 * Get ERC-20 token balance
 */
export async function getTokenBalance(
  tokenAddress: Address,
  userAddress: Address,
): Promise<bigint> {
  const client = getPublicClient();
  const result = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [userAddress],
  }) as bigint;
  return result;
}

const POOLS_SLOT = 6n;
const LIQUIDITY_OFFSET = 3n;

function getPoolStateSlot(poolId: `0x${string}`): `0x${string}` {
  return keccak256(
    encodePacked(["bytes32", "bytes32"], [poolId, `0x${POOLS_SLOT.toString(16).padStart(64, "0")}` as `0x${string}`]),
  );
}

/**
 * Get pool slot0 sqrtPriceX96 from PoolManager (Uniswap V4).
 * StateLibrary: pools[poolId] slot = keccak256(abi.encodePacked(poolId, POOLS_SLOT)); POOLS_SLOT = 6.
 * First word of Pool.State is slot0; bottom 160 bits = sqrtPriceX96. If 0, pool not initialized.
 */
export async function getPoolSlot0SqrtPriceX96(poolId: `0x${string}`): Promise<bigint> {
  const client = getPublicClient();
  const stateSlot = getPoolStateSlot(poolId);
  const data = await client.readContract({
    address: c.poolManager,
    abi: POOL_MANAGER_EXTSLOAD_ABI,
    functionName: "extsload",
    args: [stateSlot],
  }) as `0x${string}`;
  const val = BigInt(data);
  return val & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
}

/**
 * Get pool in-range liquidity (Pool.State.liquidity) from PoolManager.
 * StateLibrary: liquidity at stateSlot + LIQUIDITY_OFFSET (3); uint128.
 * If 0, swap can revert with Panic 18 (division by zero).
 */
export async function getPoolLiquidity(poolId: `0x${string}`): Promise<bigint> {
  const client = getPublicClient();
  const stateSlot = getPoolStateSlot(poolId);
  const liquiditySlot = `0x${(BigInt(stateSlot) + LIQUIDITY_OFFSET).toString(16).padStart(64, "0")}` as `0x${string}`;
  const data = await client.readContract({
    address: c.poolManager,
    abi: POOL_MANAGER_EXTSLOAD_ABI,
    functionName: "extsload",
    args: [liquiditySlot],
  }) as `0x${string}`;
  const val = BigInt(data);
  return val & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
}

/**
 * Get ERC-20 token allowance
 */
export async function getTokenAllowance(
  tokenAddress: Address,
  ownerAddress: Address,
  spenderAddress: Address,
): Promise<bigint> {
  const client = getPublicClient();
  const result = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [ownerAddress, spenderAddress],
  }) as bigint;
  return result;
}

/**
 * Get ERC-20 token decimals
 */
export async function getTokenDecimals(tokenAddress: Address): Promise<number> {
  const client = getPublicClient();
  const result = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "decimals",
  }) as number;
  return result;
}
