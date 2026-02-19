// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {MockUSDT} from "../MockUSDT.sol";

contract DeployMockUSDT is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying MockUSDT...");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        MockUSDT mockUsdt = new MockUSDT();
        console.log("MockUSDT deployed at:", address(mockUsdt));

        uint256 mintAmount = 1000 * 10**18; // 1000 tokens with 18 decimals
        mockUsdt.mintWei(deployer, mintAmount);
        console.log("Minted 1000 USDT to", deployer);

        uint256 balance = mockUsdt.balanceOf(deployer);
        console.log("Deployer balance:", balance / 10**18, "USDT");

        vm.stopBroadcast();

        console.log("\n=== Deployment Summary ===");
        console.log("MockUSDT:", address(mockUsdt));
        console.log("Symbol: mUSDT");
        console.log("Decimals: 18");
        console.log("Deployer balance:", balance / 10**18, "USDT");
    }
}
