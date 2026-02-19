// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

/**
 * @title MockPoolManagerForPerp
 * @notice Minimal mock for testing PrivBatchHook perp flow. When unlock(type=1) is called,
 *   calls back the hook; swap() returns a fixed BalanceDelta so execution price = 2800e18.
 *   Implements only the functions used in the perp path; other IPoolManager functions revert.
 */
contract MockPoolManagerForPerp is IPoolManager {
    uint256 public constant MOCK_BASE_DELTA = 1e6;
    uint256 public constant MOCK_QUOTE_DELTA = 2800e6; // execution price = 2800e18

    error NotImplemented();

    function unlock(bytes calldata data) external override returns (bytes memory) {
        if (data.length > 0 && data[0] == 0x01) {
            return IUnlockCallback(msg.sender).unlockCallback(data);
        }
        revert NotImplemented();
    }

    function swap(PoolKey memory, SwapParams memory, bytes calldata)
        external
        pure
        override
        returns (BalanceDelta)
    {
        // Return delta so execution price = quoteAbs * 1e18 / baseAbs = 2800e18
        // forge-lint: disable-next-line(unsafe-typecast)
        return toBalanceDelta(int128(int256(MOCK_BASE_DELTA)), -int128(int256(MOCK_QUOTE_DELTA)));
    }

    function sync(Currency) external pure override {
        // no-op
    }

    function settle() external payable override returns (uint256) {
        return 0;
    }

    function take(Currency currency, address to, uint256 amount) external override {
        address token = Currency.unwrap(currency);
        require(IERC20(token).transfer(to, amount), "MockPoolManager: take failed");
    }

    function initialize(PoolKey memory, uint160) external pure override returns (int24) {
        revert NotImplemented();
    }

    function modifyLiquidity(PoolKey memory, ModifyLiquidityParams memory, bytes calldata)
        external
        pure
        override
        returns (BalanceDelta, BalanceDelta)
    {
        revert NotImplemented();
    }

    function donate(PoolKey memory, uint256, uint256, bytes calldata) external pure override returns (BalanceDelta) {
        revert NotImplemented();
    }

    function settleFor(address) external payable override returns (uint256) {
        revert NotImplemented();
    }

    function clear(Currency, uint256) external pure override {
        revert NotImplemented();
    }

    function mint(address, uint256, uint256) external pure override {
        revert NotImplemented();
    }

    function burn(address, uint256, uint256) external pure override {
        revert NotImplemented();
    }

    function updateDynamicLPFee(PoolKey memory, uint24) external pure override {
        revert NotImplemented();
    }

    function protocolFeesAccrued(Currency) external pure override returns (uint256) {
        return 0;
    }

    function setProtocolFee(PoolKey memory, uint24) external pure override {
        revert NotImplemented();
    }

    function setProtocolFeeController(address) external pure override {
        revert NotImplemented();
    }

    function collectProtocolFees(address, Currency, uint256) external pure override returns (uint256) {
        revert NotImplemented();
    }

    function protocolFeeController() external pure override returns (address) {
        return address(0);
    }

    function balanceOf(address, uint256) external pure override returns (uint256) {
        return 0;
    }

    function allowance(address, address, uint256) external pure override returns (uint256) {
        return 0;
    }

    function isOperator(address, address) external pure override returns (bool) {
        return false;
    }

    function transfer(address, uint256, uint256) external pure override returns (bool) {
        revert NotImplemented();
    }

    function transferFrom(address, address, uint256, uint256) external pure override returns (bool) {
        revert NotImplemented();
    }

    function approve(address, uint256, uint256) external pure override returns (bool) {
        revert NotImplemented();
    }

    function setOperator(address, bool) external pure override returns (bool) {
        return true;
    }

    function extsload(bytes32) external pure override returns (bytes32) {
        return bytes32(0);
    }

    function extsload(bytes32, uint256 nSlots) external pure override returns (bytes32[] memory) {
        return new bytes32[](nSlots);
    }

    function extsload(bytes32[] calldata slots) external pure override returns (bytes32[] memory) {
        return new bytes32[](slots.length);
    }

    function exttload(bytes32) external pure override returns (bytes32) {
        return bytes32(0);
    }

    function exttload(bytes32[] calldata slots) external pure override returns (bytes32[] memory) {
        return new bytes32[](slots.length);
    }
}
