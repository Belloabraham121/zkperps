/**
 * Contract addresses and encoding helpers for Arbitrum Sepolia perps.
 * Matches scripts/zk/test-perp-e2e.js and PERPS_IMPLEMENTATION_PLAN.md.
 */
import { encodeFunctionData, encodeAbiParameters, keccak256 } from "viem";
import { config } from "../config.js";
const { contracts: c } = config;
// ABIs (minimal for encoding)
const ERC20_ABI = [
    {
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
    },
    {
        name: "transfer",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
    },
];
const PERP_MANAGER_ABI = [
    {
        name: "depositCollateral",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "user", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [],
    },
    {
        name: "withdrawCollateral",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "amount", type: "uint256" }],
        outputs: [],
    },
];
const HOOK_ABI = [
    {
        name: "submitPerpCommitment",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            {
                name: "key",
                type: "tuple",
                components: [
                    { name: "currency0", type: "address" },
                    { name: "currency1", type: "address" },
                    { name: "fee", type: "uint24" },
                    { name: "tickSpacing", type: "int24" },
                    { name: "hooks", type: "address" },
                ],
            },
            { name: "commitmentHash", type: "bytes32" },
        ],
        outputs: [],
    },
    {
        name: "submitPerpReveal",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            {
                name: "key",
                type: "tuple",
                components: [
                    { name: "currency0", type: "address" },
                    { name: "currency1", type: "address" },
                    { name: "fee", type: "uint24" },
                    { name: "tickSpacing", type: "int24" },
                    { name: "hooks", type: "address" },
                ],
            },
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
        outputs: [],
    },
    {
        name: "revealAndBatchExecutePerps",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            {
                name: "key",
                type: "tuple",
                components: [
                    { name: "currency0", type: "address" },
                    { name: "currency1", type: "address" },
                    { name: "fee", type: "uint24" },
                    { name: "tickSpacing", type: "int24" },
                    { name: "hooks", type: "address" },
                ],
            },
            { name: "commitmentHashes", type: "bytes32[]" },
            { name: "baseIsCurrency0", type: "bool" },
        ],
        outputs: [],
    },
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
        outputs: [{ name: "", type: "bytes32" }],
    },
];
export const contractAddresses = {
    privBatchHook: c.privBatchHook,
    perpPositionManager: c.perpPositionManager,
    mockUsdc: c.mockUsdc,
    mockUsdt: c.mockUsdt,
    marketId: c.marketId,
};
/**
 * Encode USDC approve(spender, amount) for use in sendTransaction.
 */
export function encodeUsdcApprove(spender, amount) {
    return encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, amount],
    });
}
/**
 * Encode ERC20 transfer(to, amount) for use in sendTransaction.
 * Used to fund the Hook with quote so it can settle the perp swap (see scripts/zk/test-perp-e2e.js step 5.6).
 */
export function encodeErc20Transfer(to, amount) {
    return encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [to, amount],
    });
}
/**
 * Encode PerpPositionManager.depositCollateral(user, amount).
 */
export function encodeDepositCollateral(user, amount) {
    return encodeFunctionData({
        abi: PERP_MANAGER_ABI,
        functionName: "depositCollateral",
        args: [user, amount],
    });
}
/**
 * Encode PerpPositionManager.withdrawCollateral(amount).
 * Amount in token decimals (e.g. 6 for USDC); contract converts to 18d internally.
 */
export function encodeWithdrawCollateral(amount) {
    return encodeFunctionData({
        abi: PERP_MANAGER_ABI,
        functionName: "withdrawCollateral",
        args: [amount],
    });
}
/**
 * Two-step deposit: 1) approve USDC to PerpPositionManager, 2) depositCollateral(user, amount).
 * Frontend can call POST /api/trade/send twice (approve then deposit) or we add a single deposit route that sends both.
 */
export function getDepositCollateralCalldata(user, amount) {
    return {
        approveData: encodeUsdcApprove(c.perpPositionManager, amount),
        depositData: encodeDepositCollateral(user, amount),
    };
}
/**
 * Compute PoolId from pool key (keccak256(abi.encode(poolKey))).
 * Matches Uniswap V4 PoolKey.toId().
 */
export function computePoolId(poolKey) {
    const encoded = encodeAbiParameters([
        {
            type: "tuple",
            components: [
                { name: "currency0", type: "address" },
                { name: "currency1", type: "address" },
                { name: "fee", type: "uint24" },
                { name: "tickSpacing", type: "int24" },
                { name: "hooks", type: "address" },
            ],
        },
    ], [poolKey]);
    return keccak256(encoded);
}
/**
 * Build pool key from currency addresses.
 * Ensures currency0 < currency1 (Uniswap V4 requirement).
 */
export function buildPoolKey(currency0, currency1, hookAddress) {
    // Ensure currency0 < currency1
    const sorted = currency0.toLowerCase() < currency1.toLowerCase()
        ? { currency0, currency1 }
        : { currency0: currency1, currency1: currency0 };
    return {
        currency0: sorted.currency0,
        currency1: sorted.currency1,
        fee: 3000, // 0.3% fee
        tickSpacing: 60,
        hooks: hookAddress,
    };
}
/**
 * Encode submitPerpCommitment(poolKey, commitmentHash) for use in sendTransaction.
 */
export function encodeSubmitPerpCommitment(poolKey, commitmentHash) {
    return encodeFunctionData({
        abi: HOOK_ABI,
        functionName: "submitPerpCommitment",
        args: [poolKey, commitmentHash],
    });
}
/**
 * Encode submitPerpReveal(poolKey, intent) for use in sendTransaction.
 */
export function encodeSubmitPerpReveal(poolKey, intent) {
    return encodeFunctionData({
        abi: HOOK_ABI,
        functionName: "submitPerpReveal",
        args: [poolKey, intent],
    });
}
/**
 * Encode revealAndBatchExecutePerps(poolKey, commitmentHashes, baseIsCurrency0) for use in sendTransaction.
 */
export function encodeRevealAndBatchExecutePerps(poolKey, commitmentHashes, baseIsCurrency0) {
    return encodeFunctionData({
        abi: HOOK_ABI,
        functionName: "revealAndBatchExecutePerps",
        args: [poolKey, commitmentHashes, baseIsCurrency0],
    });
}
/**
 * Encode computePerpCommitmentHash(intent) for use in eth_call (read-only).
 * Note: This is a view function, so it's typically called via RPC, not in a transaction.
 */
export function encodeComputePerpCommitmentHash(intent) {
    return encodeFunctionData({
        abi: HOOK_ABI,
        functionName: "computePerpCommitmentHash",
        args: [intent],
    });
}
//# sourceMappingURL=contracts.js.map