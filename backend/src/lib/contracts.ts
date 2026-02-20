/**
 * Contract addresses and encoding helpers for Arbitrum Sepolia perps.
 * Matches scripts/zk/test-perp-e2e.js and PERPS_IMPLEMENTATION_PLAN.md.
 */
import { encodeFunctionData } from "viem";
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
] as const;

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
] as const;

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
export function encodeUsdcApprove(spender: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
  });
}

/**
 * Encode PerpPositionManager.depositCollateral(user, amount).
 */
export function encodeDepositCollateral(user: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: PERP_MANAGER_ABI,
    functionName: "depositCollateral",
    args: [user, amount],
  });
}

/**
 * Two-step deposit: 1) approve USDC to PerpPositionManager, 2) depositCollateral(user, amount).
 * Frontend can call POST /api/trade/send twice (approve then deposit) or we add a single deposit route that sends both.
 */
export function getDepositCollateralCalldata(user: `0x${string}`, amount: bigint): {
  approveData: `0x${string}`;
  depositData: `0x${string}`;
} {
  return {
    approveData: encodeUsdcApprove(c.perpPositionManager, amount),
    depositData: encodeDepositCollateral(user, amount),
  };
}
