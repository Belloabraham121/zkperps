// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

/**
 * @title FundHook
 * @notice Transfer MockUSDT and MockUSDC to PrivBatchHook for funding perpetual swaps
 */
contract FundHook is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address hook = vm.envAddress("HOOK");
        address mockUsdt = vm.envAddress("MOCK_USDT");
        address mockUsdc = vm.envAddress("MOCK_USDC");

        console.log("Funding Hook with tokens...");
        console.log("Deployer:", deployer);
        console.log("Hook:", hook);
        console.log("MockUSDT:", mockUsdt);
        console.log("MockUSDC:", mockUsdc);

        vm.startBroadcast(deployerPrivateKey);

        IERC20 usdt = IERC20(mockUsdt);
        IERC20 usdc = IERC20(mockUsdc);

        // Transfer 25,000 MockUSDT (25k * 10^18)
        uint256 usdtAmount = 25_000 * 10**18;
        console.log("\nTransferring MockUSDT:", usdtAmount);
        usdt.transfer(hook, usdtAmount);
        console.log("MockUSDT transferred successfully");

        // Transfer 25,000 MockUSDC (25k * 10^6)
        uint256 usdcAmount = 25_000 * 10**6;
        console.log("\nTransferring MockUSDC:", usdcAmount);
        usdc.transfer(hook, usdcAmount);
        console.log("MockUSDC transferred successfully");

        vm.stopBroadcast();

        console.log("\n=== Funding Complete ===");
        console.log("Hook balance MockUSDT:", usdt.balanceOf(hook));
        console.log("Hook balance MockUSDC:", usdc.balanceOf(hook));
    }
}
