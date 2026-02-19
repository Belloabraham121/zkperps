// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {PerpPositionManager} from "../PerpPositionManager.sol";

/**
 * @title SetExecutorOnPerpManager
 * @notice Set the PrivBatchHook as executor on PerpPositionManager so the Hook can call openPosition/closePosition
 * @dev Call with PRIVATE_KEY (owner of PerpPositionManager), PERP_POSITION_MANAGER, HOOK
 */
contract SetExecutorOnPerpManager is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address perpManagerAddr = vm.envAddress("PERP_POSITION_MANAGER");
        address hookAddr = vm.envAddress("HOOK");

        console.log("Setting Hook as executor on PerpPositionManager...");
        console.log("Owner (caller):", deployer);
        console.log("PerpPositionManager:", perpManagerAddr);
        console.log("Hook (new executor):", hookAddr);

        vm.startBroadcast(deployerPrivateKey);

        PerpPositionManager perpManager = PerpPositionManager(perpManagerAddr);
        address currentExecutor = perpManager.executor();
        console.log("\nCurrent executor:", currentExecutor);

        if (currentExecutor == hookAddr) {
            console.log("Hook is already the executor. Skipping.");
        } else {
            perpManager.setExecutor(hookAddr);
            console.log("Executor set to Hook successfully!");
            require(perpManager.executor() == hookAddr, "Set failed");
        }

        vm.stopBroadcast();
        console.log("\n=== Done ===");
    }
}
