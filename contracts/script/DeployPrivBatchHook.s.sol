// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PrivBatchHook} from "../PrivBatchHook.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";
import {Groth16Verifier} from "../CommitmentVerifier.sol";

contract DeployPrivBatchHook is Script {
    // CREATE2 Deployer Proxy (used by Forge for deterministic deployments)
    address constant CREATE2_DEPLOYER = address(0x4e59b44847b379578588920cA78FbF26c0B4956C);
    
    // Arbitrum Sepolia PoolManager address
    address constant POOLMANAGER = 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317;
    
    // Arbitrum Sepolia deployed verifier address (fallback when VERIFIER_ADDRESS not set)
    address constant DEPLOYED_VERIFIER = 0x7FE24E07A4017B953259a79a9EE635e8eb226c11;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying PrivBatchHook...");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", POOLMANAGER);

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Verifier address from env VERIFIER_ADDRESS, or fallback to Arbitrum Sepolia deployed
        address verifierAddress = vm.envOr("VERIFIER_ADDRESS", DEPLOYED_VERIFIER);
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
