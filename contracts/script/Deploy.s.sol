// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Groth16Verifier} from "../CommitmentVerifier.sol";
import {MockUSDC} from "../MockUSDC.sol";
import {MockUSDT} from "../MockUSDT.sol";
import {PerpPositionManager} from "../PerpPositionManager.sol";
import {PrivBatchHook} from "../PrivBatchHook.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";
import {MockOracleAdapter} from "../test/MockOracleAdapter.sol";

/**
 * @title DeployArbitrum
 * @notice One-shot deploy for Arbitrum: CommitmentVerifier, MockUSDC, MockUSDT,
 *         PerpPositionManager, PrivBatchHook. Optionally MockOracleAdapter + one market.
 * @dev Set env:
 *      PRIVATE_KEY          - deployer key
 *      POOLMANAGER_ADDRESS  - optional; overrides default Arbitrum V4 PoolManager
 *      SKIP_ORACLE_MARKET   - set to "true" to skip oracle/market (add markets later via script/AddMarket.s.sol with your oracle)
 *
 * Arbitrum Uniswap V4 (or compatible) addresses:
 *   PoolManager                0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317
 *   Universal Router          0xefd1d4bd4cf1e86da286bb4cb1b8bced9c10ba47
 *   PositionManager           0xAc631556d3d4019C95769033B5E719dD77124BAc
 *   StateView                 0x9d467fa9062b6e9b1a46e26007ad82db116c67cb
 *   Quoter                    0x7de51022d70a725b508085468052e25e22b5c4c9
 *   PoolSwapTest              0xf3a39c86dbd13c45365e57fb90fe413371f65af8
 *   PoolModifyLiquidityTest   0x9a8ca723f5dccb7926d00b71dec55c2fea1f50f7
 *   Permit2                   0x000000000022D473030F116dDEE9F6B43aC78BA3
 */
contract Deploy is Script {
    address constant CREATE2_DEPLOYER = address(0x4e59b44847b379578588920cA78FbF26c0B4956C);
    /// @dev Default Uniswap V4 PoolManager on Arbitrum (override with POOLMANAGER_ADDRESS env)
    address constant ARBITRUM_POOLMANAGER = 0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address poolManager = vm.envOr("POOLMANAGER_ADDRESS", ARBITRUM_POOLMANAGER);
        bool skipOracleMarket = vm.envOr("SKIP_ORACLE_MARKET", false);

        console.log("=== Deploying zkperps stack on Arbitrum ===");
        console.log("Deployer:", deployer);
        console.log("PoolManager:", poolManager);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Commitment verifier (Groth16)
        Groth16Verifier verifier = new Groth16Verifier();
        console.log("Groth16Verifier:", address(verifier));

        // 2. Mock tokens
        MockUSDC mockUsdc = new MockUSDC();
        MockUSDT mockUsdt = new MockUSDT();
        console.log("MockUSDC:", address(mockUsdc));
        console.log("MockUSDT:", address(mockUsdt));

        mockUsdc.mintWei(deployer, 1_000_000 * 1e6);
        mockUsdt.mintWei(deployer, 1_000_000 * 1e18);
        console.log("Minted mock tokens to deployer");

        // 3. PerpPositionManager (owner = deployer, executor = 0 until hook is deployed)
        PerpPositionManager perpManager = new PerpPositionManager(
            IERC20(address(mockUsdc)),
            deployer,
            address(0)
        );
        console.log("PerpPositionManager:", address(perpManager));

        // 4. PrivBatchHook (needs PoolManager + verifier)
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            type(PrivBatchHook).creationCode,
            abi.encode(IPoolManager(poolManager), address(verifier))
        );
        PrivBatchHook hook = new PrivBatchHook{salt: salt}(
            IPoolManager(poolManager),
            verifier
        );
        require(address(hook) == hookAddress, "Hook address mismatch");
        console.log("PrivBatchHook:", address(hook));

        // 5. Wire: hook is executor for perp manager; perp manager is set on hook
        perpManager.setExecutor(address(hook));
        hook.setPerpPositionManagerAddress(address(perpManager));
        console.log("Wired PerpPositionManager <-> PrivBatchHook");

        // 6. Optional: MockOracleAdapter + one market (for testing / dev)
        if (!skipOracleMarket) {
            MockOracleAdapter oracle = new MockOracleAdapter();
            oracle.setPrice(address(0x1), 2800e18); // e.g. ETH market id
            bytes32 poolIdEth = keccak256("ETH/USDC");
            perpManager.createMarket(
                address(0x1),
                poolIdEth,
                address(oracle),
                10e18,
                0.05e18
            );
            console.log("MockOracleAdapter:", address(oracle));
            console.log("Created market (ETH) on PerpPositionManager");
        }

        vm.stopBroadcast();

        console.log("\n=== Deployment summary ===");
        console.log("Groth16Verifier:    ", address(verifier));
        console.log("MockUSDC:           ", address(mockUsdc));
        console.log("MockUSDT:           ", address(mockUsdt));
        console.log("PerpPositionManager:", address(perpManager));
        console.log("PrivBatchHook:      ", address(hook));
    }
}
