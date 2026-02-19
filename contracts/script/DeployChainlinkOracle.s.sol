// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {ChainlinkOracleAdapter} from "../ChainlinkOracleAdapter.sol";

/**
 * @title DeployChainlinkOracle
 * @notice Deploy ChainlinkOracleAdapter and optionally set one feed (e.g. ETH/USD).
 *
 * Env:
 *   PRIVATE_KEY              - deployer (will be the adapter owner / setter)
 *   MARKET_ID                - market id for this feed (e.g. 0x0000000000000000000000000000000000000001 for ETH)
 *   CHAINLINK_FEED_ADDRESS   - Chainlink Aggregator address for that pair
 *
 * Arbitrum One feed addresses (from https://docs.chain.link/data-feeds/price-feeds/addresses?network=arbitrum):
 *   ETH/USD: 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612
 *   BTC/USD: 0x6ce185860a4963106506C203335A291051365e6Ca
 *
 * Then add the market to PerpPositionManager:
 *   export PERP_MANAGER_ADDRESS=0x...
 *   export ORACLE_ADDRESS=<deployed ChainlinkOracleAdapter address>
 *   export MARKET_ID=0x0000000000000000000000000000000000000001
 *   export POOL_ID=0x$(cast keccak "ETH/USDC")
 *   forge script script/AddMarket.s.sol:AddMarket --rpc-url arbitrum_one --broadcast
 */
contract DeployChainlinkOracle is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        ChainlinkOracleAdapter adapter = new ChainlinkOracleAdapter();
        console.log("ChainlinkOracleAdapter:", address(adapter));

        address marketId = vm.envOr("MARKET_ID", address(0));
        address feedAddress = vm.envOr("CHAINLINK_FEED_ADDRESS", address(0));
        if (marketId != address(0) && feedAddress != address(0)) {
            adapter.setFeed(marketId, feedAddress);
            console.log("Set feed for market", marketId, "->", feedAddress);
        }

        vm.stopBroadcast();

        console.log("\nUse this as ORACLE_ADDRESS when adding a market (AddMarket.s.sol).");
    }
}
