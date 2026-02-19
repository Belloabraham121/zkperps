// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {ChainlinkOracleAdapter} from "../ChainlinkOracleAdapter.sol";

/**
 * @title UpdateChainlinkFeed
 * @notice Update the feed address for a market in an existing ChainlinkOracleAdapter.
 *
 * Env:
 *   PRIVATE_KEY              - account that will call setFeed (can be deployer or any account)
 *   ORACLE_ADAPTER_ADDRESS   - address of the deployed ChainlinkOracleAdapter
 *   MARKET_ID                - market id (e.g. 0x0000000000000000000000000000000000000001 for ETH)
 *   CHAINLINK_FEED_ADDRESS   - Chainlink Aggregator address for that pair
 *
 * Arbitrum Sepolia feed addresses:
 *   ETH/USD Standard Proxy: 0x1C352C8C42eF40F9951C5a251cb1cb0492Ec0e52
 *
 * Usage:
 *   export PRIVATE_KEY=0x...
 *   export ORACLE_ADAPTER_ADDRESS=0x991eb2241b5f2875a5cb4dbba6450b343e8216be
 *   export MARKET_ID=0x0000000000000000000000000000000000000001
 *   export CHAINLINK_FEED_ADDRESS=0x1C352C8C42eF40F9951C5a251cb1cb0492Ec0e52
 *   forge script script/UpdateChainlinkFeed.s.sol:UpdateChainlinkFeed --rpc-url arbitrum_sepolia --broadcast
 */
contract UpdateChainlinkFeed is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address oracleAdapterAddress = vm.envAddress("ORACLE_ADAPTER_ADDRESS");
        address marketId = vm.envAddress("MARKET_ID");
        address feedAddress = vm.envAddress("CHAINLINK_FEED_ADDRESS");

        console.log("Updating ChainlinkOracleAdapter feed:");
        console.log("  Adapter:", oracleAdapterAddress);
        console.log("  Market ID:", marketId);
        console.log("  Feed address:", feedAddress);
        console.log("  Caller:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        ChainlinkOracleAdapter adapter = ChainlinkOracleAdapter(oracleAdapterAddress);
        adapter.setFeed(marketId, feedAddress);

        console.log("\nFeed updated successfully!");
        console.log("You can now call getPriceWithFallback on the adapter with MARKET_ID:", marketId);

        vm.stopBroadcast();
    }
}
