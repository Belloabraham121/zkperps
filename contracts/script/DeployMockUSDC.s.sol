// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {MockUSDC} from "../MockUSDC.sol";

contract DeployMockUSDC is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying MockUSDC...");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        MockUSDC mockUsdc = new MockUSDC();
        console.log("MockUSDC deployed at:", address(mockUsdc));

        uint256 mintAmount = 1000 * 10**6; // 1000 tokens with 6 decimals
        mockUsdc.mintWei(deployer, mintAmount);
        console.log("Minted 1000 USDC to", deployer);

        uint256 balance = mockUsdc.balanceOf(deployer);
        console.log("Deployer balance:", balance / 10**6, "USDC");

        vm.stopBroadcast();

        console.log("\n=== Deployment Summary ===");
        console.log("MockUSDC:", address(mockUsdc));
        console.log("Symbol: mUSDC");
        console.log("Decimals: 6");
        console.log("Deployer balance:", balance / 10**6, "USDC");
    }
}
