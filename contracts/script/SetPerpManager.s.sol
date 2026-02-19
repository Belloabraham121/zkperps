// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {PrivBatchHook} from "../PrivBatchHook.sol";

/**
 * @title SetPerpManager
 * @notice Set the PerpPositionManager on PrivBatchHook
 */
contract SetPerpManager is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address hook = vm.envAddress("HOOK");
        address perpManager = vm.envAddress("PERP_POSITION_MANAGER");

        console.log("Setting PerpPositionManager on Hook...");
        console.log("Deployer:", deployer);
        console.log("Hook:", hook);
        console.log("PerpPositionManager:", perpManager);

        vm.startBroadcast(deployerPrivateKey);

        PrivBatchHook hookContract = PrivBatchHook(hook);
        
        // Check current state
        address currentManager = address(hookContract.perpPositionManager());
        console.log("\nCurrent perpPositionManager:", currentManager);
        
        if (currentManager != address(0)) {
            console.log("WARNING: perpPositionManager already set! Skipping...");
        } else {
            hookContract.setPerpPositionManagerAddress(perpManager);
            console.log("PerpPositionManager set successfully!");
            
            // Verify
            address newManager = address(hookContract.perpPositionManager());
            console.log("Verified perpPositionManager:", newManager);
            require(newManager == perpManager, "Set failed");
        }

        vm.stopBroadcast();

        console.log("\n=== Setup Complete ===");
    }
}
