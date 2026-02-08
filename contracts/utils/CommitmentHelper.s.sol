// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {PrivBatchHook} from "../src/PrivBatchHook.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

/**
 * @title CommitmentHelper
 * @notice Helper script for users to generate and submit commitments
 */
contract CommitmentHelper is Script {
    function run() external {
        address hookAddress = vm.envAddress("HOOK_ADDRESS");
        address userAddress = vm.envAddress("USER_ADDRESS");
        uint256 userPrivateKey = vm.envUint("PRIVATE_KEY");
        
        address tokenIn = vm.envAddress("TOKEN_IN");
        address tokenOut = vm.envAddress("TOKEN_OUT");
        uint256 amountIn = vm.envUint("AMOUNT_IN");
        uint256 minAmountOut = vm.envUint("MIN_AMOUNT_OUT");
        address recipient = vm.envAddress("RECIPIENT");
        uint256 nonce = vm.envUint("NONCE");
        uint256 deadline = block.timestamp + 1 hours;
        
        PrivBatchHook hook = PrivBatchHook(hookAddress);
        
        // Create swap intent
        PrivBatchHook.SwapIntent memory intent = PrivBatchHook.SwapIntent({
            user: userAddress,
            tokenIn: Currency.wrap(tokenIn),
            tokenOut: Currency.wrap(tokenOut),
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            recipient: recipient,
            nonce: nonce,
            deadline: deadline
        });
        
        // Compute commitment hash
        bytes32 commitmentHash = hook.computeCommitmentHash(intent);
        
        console.log("Commitment Hash:", vm.toString(commitmentHash));
        console.log("User:", userAddress);
        console.log("Token In:", tokenIn);
        console.log("Amount In:", amountIn);
        console.log("Min Amount Out:", minAmountOut);
        console.log("Nonce:", nonce);
        console.log("Deadline:", deadline);
        
        // Save intent to file for later reveal
        string memory intentJson = string(abi.encodePacked(
            '{"user":"', vm.toString(userAddress), '",',
            '"tokenIn":"', vm.toString(tokenIn), '",',
            '"tokenOut":"', vm.toString(tokenOut), '",',
            '"amountIn":"', vm.toString(amountIn), '",',
            '"minAmountOut":"', vm.toString(minAmountOut), '",',
            '"recipient":"', vm.toString(recipient), '",',
            '"nonce":"', vm.toString(nonce), '",',
            '"deadline":"', vm.toString(deadline), '"}'
        ));
        
        vm.writeFile("./intent.json", intentJson);
        console.log("Intent saved to intent.json");
    }
}
