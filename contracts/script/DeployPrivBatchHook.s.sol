// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PrivBatchHook} from "../PrivBatchHook.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";

contract DeployPrivBatchHook is Script {
    // Base Sepolia PoolManager address
    address constant POOLMANAGER = 0x8C4BcBE6b9eF47855f97E675296FA3F6fafa5F1A;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying PrivBatchHook...");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", POOLMANAGER);

        vm.startBroadcast(deployerPrivateKey);

        // Mine for hook address with correct flags
        // We need beforeSwap and afterSwap flags
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG |
                Hooks.AFTER_SWAP_FLAG |
                Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );

        // Find salt that gives us address with correct flags
        (address hookAddress, bytes32 salt) = HookMiner.find(
            deployer,
            flags,
            type(PrivBatchHook).creationCode,
            abi.encode(POOLMANAGER)
        );

        console.log("Mined hook address:", hookAddress);
        console.log("Salt:", vm.toString(salt));

        // Deploy hook using CREATE2
        PrivBatchHook hook = new PrivBatchHook{salt: salt}(
            IPoolManager(POOLMANAGER)
        );

        require(address(hook) == hookAddress, "Hook address mismatch");

        console.log("PrivBatchHook deployed at:", address(hook));

        vm.stopBroadcast();
    }
}
