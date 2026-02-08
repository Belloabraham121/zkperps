// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Groth16Verifier} from "../CommitmentVerifier.sol";
import {PrivBatchHook} from "../PrivBatchHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";

/**
 * @title PrivBatchHookZKTest
 * @notice Comprehensive tests for ZK proof integration with PrivBatchHook
 * @dev Tests submitCommitmentWithProof, revealAndBatchExecuteWithProofs, and related functions
 */
contract PrivBatchHookZKTest is Test {
    using PoolIdLibrary for PoolKey;

    Groth16Verifier verifier;
    PrivBatchHook hook;
    IPoolManager poolManager;

    // Valid proof from build/zk/proof.json and build/zk/public.json
    function getValidA() internal pure returns (uint[2] memory) {
        return [
            uint256(17002299895928590336027953136176593770942021334429510429547120270983041214405),
            uint256(6947303486410269252917513017734334161671303213768473474962467883267847974646)
        ];
    }
    
    function getValidB() internal pure returns (uint[2][2] memory) {
        return [
            [
                uint256(12390606658959339806304769971768157266554196400277049355851676804197362266192),
                uint256(4324244732169176280330390811917704582606188290902304005922335301580960410951)
            ],
            [
                uint256(12533441529731975719976100092662198908364404644836821682649263654513801012771),
                uint256(3108378817970598942026255066191671615189500496142227204429162940129286092020)
            ]
        ];
    }
    
    function getValidC() internal pure returns (uint[2] memory) {
        return [
            uint256(18721720203810119944160531538871544797401199464080421565626513118012554237738),
            uint256(9712642516648492560593987944343454514029576329637114704869187502381844962718)
        ];
    }
    
    uint256 constant VALID_COMMITMENT_HASH = 15487518024730841941762307804339002357283870537119939381941957344477347729321;

    // Mock pool key for testing
    PoolKey poolKey;
    PoolId poolId;

    function setUp() public {
        // Deploy verifier contract
        verifier = new Groth16Verifier();
        
        // For testing, we'll use a mock pool manager address
        // In real tests, you'd use the actual PoolManager from v4-core
        poolManager = IPoolManager(address(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408)); // Base Sepolia PoolManager
        
        // Deploy hook with verifier address using HookMiner to find correct address
        // Hook needs to be deployed at an address that matches the hook flags
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        
        // For testing, we can use address(0) as deployer or use CREATE2_DEPLOYER
        // The key is that HookMiner.find() needs to find an address with the correct flags
        address deployer = address(this); // Use test contract as deployer for testing
        
        // Mine for hook address with correct flags
        (address hookAddress, bytes32 salt) = HookMiner.find(
            deployer,
            flags,
            type(PrivBatchHook).creationCode,
            abi.encode(poolManager, address(verifier))
        );
        
        // Deploy hook using CREATE2 with the mined salt
        hook = new PrivBatchHook{salt: salt}(poolManager, verifier);
        
        // Verify hook was deployed at the expected address
        require(address(hook) == hookAddress, "Hook address mismatch");
        
        // Setup pool key with the deployed hook
        poolKey = PoolKey({
            currency0: Currency.wrap(address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48)), // USDC
            currency1: Currency.wrap(address(0xdAC17F958D2ee523a2206206994597C13D831ec7)), // USDT
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        poolId = poolKey.toId();
    }

    /**
     * @notice Test 1: Deploy hook with verifier address
     * @dev Verifies hook is deployed correctly with verifier address
     */
    function testDeployHook_WithVerifier() public view {
        assertTrue(address(hook) != address(0), "Hook should be deployed");
        assertTrue(address(hook.verifier()) == address(verifier), "Hook should have verifier address");
        assertTrue(address(hook.poolManager()) == address(poolManager), "Hook should have pool manager");
    }

    /**
     * @notice Test 2: Submit commitment with valid proof
     */
    function testSubmitCommitmentWithProof_Valid() public {
        bytes32 commitmentHash = bytes32(VALID_COMMITMENT_HASH);
        uint[2] memory a = getValidA();
        uint[2][2] memory b = getValidB();
        uint[2] memory c = getValidC();
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        // Submit commitment with proof
        hook.submitCommitmentWithProof(
            poolKey,
            commitmentHash,
            a,
            b,
            c,
            publicSignals
        );

        // Verify commitment is marked as verified
        assertTrue(hook.verifiedCommitments(commitmentHash), "Commitment should be marked as verified");
    }

    /**
     * @notice Test 3: Submit commitment with invalid proof (should revert)
     */
    function testSubmitCommitmentWithProof_InvalidProof() public {
        bytes32 commitmentHash = bytes32(VALID_COMMITMENT_HASH);
        uint[2] memory corruptedA = [getValidA()[0], getValidA()[1] + 1]; // Corrupt proof
        uint[2][2] memory b = getValidB();
        uint[2] memory c = getValidC();
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        // Should revert with invalid proof
        vm.expectRevert();
        hook.submitCommitmentWithProof(
            poolKey,
            commitmentHash,
            corruptedA,
            b,
            c,
            publicSignals
        );
    }

    /**
     * @notice Test 4: Submit commitment with wrong commitmentHash (should revert)
     */
    function testSubmitCommitmentWithProof_WrongHash() public {
        bytes32 wrongHash = bytes32(uint256(9999999999999999999999999999999999999999999999999999999999999999));
        uint[2] memory a = getValidA();
        uint[2][2] memory b = getValidB();
        uint[2] memory c = getValidC();
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH]; // Correct hash in proof

        // Should revert because public signal doesn't match commitmentHash parameter
        vm.expectRevert();
        hook.submitCommitmentWithProof(
            poolKey,
            wrongHash, // Wrong hash parameter
            a,
            b,
            c,
            publicSignals
        );
    }

    /**
     * @notice Test 5: Submit commitment with proof - creates commitment if doesn't exist
     */
    function testSubmitCommitmentWithProof_CreatesCommitment() public {
        bytes32 commitmentHash = bytes32(VALID_COMMITMENT_HASH);
        uint[2] memory a = getValidA();
        uint[2][2] memory b = getValidB();
        uint[2] memory c = getValidC();
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        // Get initial commitment count
        uint256 initialCount = hook.getCommitments(poolId).length;

        // Submit commitment with proof
        hook.submitCommitmentWithProof(
            poolKey,
            commitmentHash,
            a,
            b,
            c,
            publicSignals
        );

        // Verify commitment was created
        uint256 finalCount = hook.getCommitments(poolId).length;
        assertEq(finalCount, initialCount + 1, "Commitment should be created");
        assertTrue(hook.verifiedCommitments(commitmentHash), "Commitment should be verified");
    }

    /**
     * @notice Test 6: Verify commitment proof internal function (via submitCommitmentWithProof)
     */
    function testVerifyCommitmentProof_Internal() public {
        bytes32 commitmentHash = bytes32(VALID_COMMITMENT_HASH);
        uint[2] memory a = getValidA();
        uint[2][2] memory b = getValidB();
        uint[2] memory c = getValidC();
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        // The verifyCommitmentProof is internal, so we test it via submitCommitmentWithProof
        // If this succeeds, the internal function works correctly
        hook.submitCommitmentWithProof(
            poolKey,
            commitmentHash,
            a,
            b,
            c,
            publicSignals
        );

        assertTrue(hook.verifiedCommitments(commitmentHash), "Proof verification should succeed");
    }

    /**
     * @notice Test 7: Reveal and batch execute with valid proofs
     * @dev This is a complex test that requires proper setup with tokens and pool
     *      For now, we test the proof verification part
     */
    function testRevealAndBatchExecuteWithProofs_Valid() public {
        // Note: Full batch execution requires pool with liquidity, token approvals, etc.
        // This test focuses on the proof verification part
        
        bytes32 commitmentHash = bytes32(VALID_COMMITMENT_HASH);
        uint[2] memory a = getValidA();
        uint[2][2] memory b = getValidB();
        uint[2] memory c = getValidC();
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        // First, submit commitment with proof
        hook.submitCommitmentWithProof(
            poolKey,
            commitmentHash,
            a,
            b,
            c,
            publicSignals
        );

        // Verify commitment is marked as verified
        assertTrue(hook.verifiedCommitments(commitmentHash), "Commitment should be verified");
        
        // Note: Full batch execution test would require:
        // - Pool with liquidity
        // - Token approvals
        // - Multiple commitments
        // - Proper swap intents
        // This verifies the proof verification part works
    }

    /**
     * @notice Test 8: Reveal and batch execute with invalid proofs (should revert)
     */
    function testRevealAndBatchExecuteWithProofs_InvalidProof() public {
        bytes32 commitmentHash = bytes32(VALID_COMMITMENT_HASH);
        uint[2] memory corruptedA = [getValidA()[0], getValidA()[1] + 1];
        uint[2][2] memory b = getValidB();
        uint[2] memory c = getValidC();
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        // Create a minimal swap intent (this would normally come from the commitment)
        PrivBatchHook.SwapIntent memory intent = PrivBatchHook.SwapIntent({
            user: address(0x1234),
            tokenIn: poolKey.currency0,
            tokenOut: poolKey.currency1,
            amountIn: 1000000,
            minAmountOut: 900000,
            recipient: address(0x1234),
            nonce: 1,
            deadline: block.timestamp + 1 hours
        });

        bytes32[] memory commitmentHashes = new bytes32[](1);
        commitmentHashes[0] = commitmentHash;

        uint[2][] memory proofsA = new uint[2][](1);
        proofsA[0] = corruptedA;

        uint[2][2][] memory proofsB = new uint[2][2][](1);
        proofsB[0] = b;

        uint[2][] memory proofsC = new uint[2][](1);
        proofsC[0] = c;

        uint[1][] memory publicSignalsArray = new uint[1][](1);
        publicSignalsArray[0] = publicSignals;

        PrivBatchHook.SwapIntent[] memory intents = new PrivBatchHook.SwapIntent[](1);
        intents[0] = intent;

        // Should revert due to invalid proof
        vm.expectRevert();
        hook.revealAndBatchExecuteWithProofs(
            poolKey,
            commitmentHashes,
            proofsA,
            proofsB,
            proofsC,
            publicSignalsArray,
            intents
        );
    }

    /**
     * @notice Test 9: Verify commitments are marked as verified correctly
     */
    function testCommitments_MarkedAsVerified() public {
        bytes32 commitmentHash = bytes32(VALID_COMMITMENT_HASH);
        uint[2] memory a = getValidA();
        uint[2][2] memory b = getValidB();
        uint[2] memory c = getValidC();
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        // Initially not verified
        assertFalse(hook.verifiedCommitments(commitmentHash), "Commitment should not be verified initially");

        // Submit with proof
        hook.submitCommitmentWithProof(
            poolKey,
            commitmentHash,
            a,
            b,
            c,
            publicSignals
        );

        // Now should be verified
        assertTrue(hook.verifiedCommitments(commitmentHash), "Commitment should be verified after proof submission");
    }

    /**
     * @notice Test 10: Multiple commitments with proofs
     */
    function testMultipleCommitments_WithProofs() public {
        bytes32 commitmentHash1 = bytes32(VALID_COMMITMENT_HASH);
        // Note: For a real test, we'd need a second valid proof for a different commitment
        // For now, we verify the first commitment works
        
        uint[2] memory a = getValidA();
        uint[2][2] memory b = getValidB();
        uint[2] memory c = getValidC();

        // Submit first commitment
        hook.submitCommitmentWithProof(
            poolKey,
            commitmentHash1,
            a,
            b,
            c,
            [VALID_COMMITMENT_HASH]
        );

        // Verify first commitment is verified
        assertTrue(hook.verifiedCommitments(commitmentHash1), "First commitment should be verified");
        
        // Note: Full test would submit multiple commitments with different proofs
        // Each commitment requires its own valid proof matching its parameters
    }

    /**
     * @notice Test 11: Event emission for verified commitments
     */
    function testEvent_CommitmentVerified() public {
        bytes32 commitmentHash = bytes32(VALID_COMMITMENT_HASH);
        uint[2] memory a = getValidA();
        uint[2][2] memory b = getValidB();
        uint[2] memory c = getValidC();
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        // Expect CommitmentVerified event
        vm.expectEmit(true, true, false, false);
        emit PrivBatchHook.CommitmentVerified(poolId, commitmentHash);

        hook.submitCommitmentWithProof(
            poolKey,
            commitmentHash,
            a,
            b,
            c,
            publicSignals
        );
    }
}
