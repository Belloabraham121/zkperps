// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {PerpPositionManager} from "../PerpPositionManager.sol";

/**
 * @title AddMarket
 * @notice Add a market to an already-deployed PerpPositionManager with any IOracleAdapter.
 * @dev Run after Deploy.s.sol (with SKIP_ORACLE_MARKET=true) or when adding more markets.
 *
 * Env:
 *   PRIVATE_KEY           - owner of PerpPositionManager
 *   PERP_MANAGER_ADDRESS  - PerpPositionManager contract
 *   MARKET_ID             - address used as market id (e.g. 0x0000000000000000000000000000000000000001 for ETH)
 *   POOL_ID               - bytes32 pool id (hex, e.g. 0x... or use ORACLE_ADDRESS for dev)
 *   ORACLE_ADDRESS        - contract implementing getPriceWithFallback(market) returns (uint256 18 decimals)
 *   MAX_LEVERAGE          - e.g. 10000000000000000000 for 10e18
 *   MAINTENANCE_MARGIN    - e.g. 50000000000000000 for 0.05e18 (5%)
 *
 * Example (Arbitrum):
 *   export PERP_MANAGER_ADDRESS=0x...
 *   export MARKET_ID=0x0000000000000000000000000000000000000001
 *   export POOL_ID=0x$(cast keccak "ETH/USDC")
 *   export ORACLE_ADDRESS=0x...   # your Chainlink adapter or MockOracleAdapter
 *   export MAX_LEVERAGE=10000000000000000000
 *   export MAINTENANCE_MARGIN=50000000000000000
 *   forge script script/AddMarket.s.sol:AddMarket --rpc-url arbitrum_one --broadcast
 */
contract AddMarket is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(deployerPrivateKey);
        PerpPositionManager perpManager = PerpPositionManager(vm.envAddress("PERP_MANAGER_ADDRESS"));
        address marketId = vm.envAddress("MARKET_ID");
        bytes32 poolId = vm.envBytes32("POOL_ID");
        address oracleAddress = vm.envAddress("ORACLE_ADDRESS");
        uint256 maxLeverage = vm.envOr("MAX_LEVERAGE", uint256(10e18));
        uint256 maintenanceMargin = vm.envOr("MAINTENANCE_MARGIN", uint256(0.05e18));

        console.log("Adding market to PerpPositionManager:", address(perpManager));
        console.log("Market ID:", marketId);
        console.log("Oracle:", oracleAddress);
        console.log("Max leverage:", maxLeverage);
        console.log("Maintenance margin:", maintenanceMargin);

        vm.startBroadcast(deployerPrivateKey);
        perpManager.createMarket(marketId, poolId, oracleAddress, maxLeverage, maintenanceMargin);
        vm.stopBroadcast();

        console.log("Market created.");
    }
}
