// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PrivBatchHook} from "../PrivBatchHook.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";
import {Groth16Verifier} from "../CommitmentVerifier.sol";

contract DeployPrivBatchHook is Script {
    // CREATE2 Deployer Proxy (used by Forge for deterministic deployments)
    address constant CREATE2_DEPLOYER = address(0x4e59b44847b379578588920cA78FbF26c0B4956C);
    
    // Base Sepolia PoolManager address
    address constant POOLMANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    
    // Base Sepolia deployed verifier address (from previous deployment)
    address constant DEPLOYED_VERIFIER = 0x09F3bCe3546C3b4348E31B6E86A271c42b39672e;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying PrivBatchHook...");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", POOLMANAGER);

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Use existing deployed verifier address
        // The verifier is already deployed, we just pass its address to the hook
        address verifierAddress = DEPLOYED_VERIFIER;
        Groth16Verifier verifier = Groth16Verifier(verifierAddress);
        
        console.log("\n=== Using Deployed Verifier ===");
        console.log("Verifier address:", verifierAddress);
        console.log("Note: Verifier is NOT being redeployed - using existing address");

        // Step 2: Mine for hook address with correct flags
        // We need beforeSwap and afterSwap flags
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG |
                Hooks.AFTER_SWAP_FLAG |
                Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );

        // Find salt that gives us address with correct flags
        // Note: Hook constructor now takes both poolManager and verifier
        // Use CREATE2_DEPLOYER for address mining (this is what Forge uses for CREATE2)
        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            type(PrivBatchHook).creationCode,
            abi.encode(IPoolManager(POOLMANAGER), verifierAddress)
        );

        console.log("\n=== Mining Hook Address ===");
        console.log("Mined hook address:", hookAddress);
        console.log("Salt:", vm.toString(salt));

        // Step 3: Deploy hook using CREATE2
        console.log("\n=== Deploying PrivBatchHook ===");
        PrivBatchHook hook = new PrivBatchHook{salt: salt}(
            IPoolManager(POOLMANAGER),
            verifier
        );

        require(address(hook) == hookAddress, "Hook address mismatch");

        console.log("PrivBatchHook deployed at:", address(hook));
        console.log("\n=== Deployment Summary ===");
        console.log("Verifier (existing):", verifierAddress);
        console.log("Hook (new):", address(hook));

        vm.stopBroadcast();
    }
}
