/**
 * Contract state reader using viem for reading on-chain data.
 * Used for querying positions, collateral, and other view functions.
 */
import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { config } from "../config.js";
const { contracts: c, rpcUrl } = config;
// Note: chainId from config is ignored - always uses Arbitrum Sepolia (421614)
// Create public client for reading contract state
// Always uses Arbitrum Sepolia (421614) - hardcoded default
function getPublicClient() {
    if (!rpcUrl) {
        throw new Error("RPC_URL must be set to read contract state");
    }
    // Always use Arbitrum Sepolia - hardcoded default
    return createPublicClient({
        chain: arbitrumSepolia, // Always Arbitrum Sepolia (421614)
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
];
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
];
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
];
/**
 * Get user's total collateral from PerpPositionManager
 */
export async function getTotalCollateral(userAddress) {
    const client = getPublicClient();
    const result = await client.readContract({
        address: c.perpPositionManager,
        abi: PERP_MANAGER_ABI,
        functionName: "getTotalCollateral",
        args: [userAddress],
    });
    return result;
}
/**
 * Get user's position for a specific market
 */
export async function getPosition(userAddress, marketId) {
    const client = getPublicClient();
    const result = await client.readContract({
        address: c.perpPositionManager,
        abi: PERP_MANAGER_ABI,
        functionName: "getPosition",
        args: [userAddress, marketId],
    });
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
export async function getAvailableMargin(userAddress) {
    const client = getPublicClient();
    const result = await client.readContract({
        address: c.perpPositionManager,
        abi: PERP_MANAGER_ABI,
        functionName: "getAvailableMargin",
        args: [userAddress],
    });
    return result;
}
/**
 * Compute perp commitment hash from intent (read-only call)
 */
export async function computePerpCommitmentHash(intent) {
    const client = getPublicClient();
    const result = await client.readContract({
        address: c.privBatchHook,
        abi: HOOK_ABI,
        functionName: "computePerpCommitmentHash",
        args: [intent],
    });
    return result;
}
/**
 * Get batch interval from Hook
 */
export async function getBatchInterval() {
    const client = getPublicClient();
    const result = await client.readContract({
        address: c.privBatchHook,
        abi: HOOK_ABI,
        functionName: "BATCH_INTERVAL",
    });
    return result;
}
/**
 * Get batch state for a pool
 */
export async function getBatchState(poolId) {
    const client = getPublicClient();
    const result = await client.readContract({
        address: c.privBatchHook,
        abi: HOOK_ABI,
        functionName: "perpBatchStates",
        args: [poolId],
    });
    return {
        lastBatchTimestamp: result[0],
        commitmentCount: result[1],
    };
}
/**
 * Get ERC-20 token balance
 */
export async function getTokenBalance(tokenAddress, userAddress) {
    const client = getPublicClient();
    const result = await client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [userAddress],
    });
    return result;
}
/**
 * Get ERC-20 token allowance
 */
export async function getTokenAllowance(tokenAddress, ownerAddress, spenderAddress) {
    const client = getPublicClient();
    const result = await client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [ownerAddress, spenderAddress],
    });
    return result;
}
/**
 * Get ERC-20 token decimals
 */
export async function getTokenDecimals(tokenAddress) {
    const client = getPublicClient();
    const result = await client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "decimals",
    });
    return result;
}
//# sourceMappingURL=contract-reader.js.map