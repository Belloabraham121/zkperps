// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {PrivBatchHook} from "../src/PrivBatchHook.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

/**
 * @title MonitorAndExecute
 * @notice Simple script to monitor batch conditions and execute when ready
 * @dev For hackathon demo - can be run manually or via cron job
 *      This replaces paid automation services with a simple monitoring script
 */
contract MonitorAndExecute is Script {
    using PoolIdLibrary for PoolKey;

    function run() external {
        address hookAddress = vm.envAddress("HOOK_ADDRESS");
        PrivBatchHook hook = PrivBatchHook(hookAddress);

        // Get pool key from environment
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(vm.envAddress("TOKEN0_ADDRESS")),
            currency1: Currency.wrap(vm.envAddress("TOKEN1_ADDRESS")),
            fee: uint24(vm.envUint("POOL_FEE")),
            tickSpacing: int24(int256(vm.envUint("TICK_SPACING"))),
            hooks: IHooks(hookAddress)
        });

        PoolId poolId = poolKey.toId();

        console.log("Monitoring PrivBatchHook execution conditions...");
        console.log("Hook Address:", hookAddress);
        console.log("Pool ID:", vm.toString(uint256(PoolId.unwrap(poolId))));
        console.log("Block Timestamp:", block.timestamp);

        // Check conditions
        (bool canExec, ) = hook.checker(poolId);

        console.log("\n=== Execution Conditions ===");
        console.log("Can Execute:", canExec);

        if (canExec) {
            console.log("\n[SUCCESS] Conditions met! Ready to execute batch.");
            console.log("\nTo execute, you need to:");
            console.log("1. Collect reveals from CommitmentSubmitted events");
            console.log("2. Call: hook.revealAndBatchExecute(poolKey, reveals)");
            console.log("\nExample:");
            console.log("  forge script script/ExecuteBatch.s.sol:ExecuteBatch \\");
            console.log("    --rpc-url $RPC_URL \\");
            console.log("    --broadcast");
        } else {
            console.log("\n[INFO] Conditions not met. Checking details...");

            uint256 pendingCount = hook.getPendingCommitmentCount(poolId);
            console.log("Pending Commitments:", pendingCount);
            console.log("Required Minimum:", hook.MIN_COMMITMENTS());

            (uint256 lastBatchTimestamp, uint256 batchNonce) = hook.batchStates(poolId);
            console.log("Last Batch Timestamp:", lastBatchTimestamp);
            console.log("Batch Nonce:", batchNonce);
            console.log("Batch Interval:", hook.BATCH_INTERVAL());
            
            uint256 timeSince = block.timestamp - lastBatchTimestamp;
            console.log("Time Since Last Batch:", timeSince);
            
            if (timeSince < hook.BATCH_INTERVAL()) {
                uint256 timeRemaining = hook.BATCH_INTERVAL() - timeSince;
                console.log("Time Remaining:", timeRemaining, "seconds");
            }

            if (pendingCount < hook.MIN_COMMITMENTS()) {
                console.log("\n[WARNING] Not enough commitments. Need:", hook.MIN_COMMITMENTS());
            }

            if (timeSince < hook.BATCH_INTERVAL()) {
                console.log("\n[WARNING] Batch interval not elapsed.");
            }
        }
    }
}
