// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title MockOracleAdapter
 * @notice Mock price oracle for testing PerpPositionManager. setPrice(market, price) then getPriceWithFallback returns it (18 decimals).
 */
contract MockOracleAdapter {
    mapping(address => uint256) public price;

    function setPrice(address market, uint256 _price) external {
        price[market] = _price;
    }

    function getPriceWithFallback(address market) external view returns (uint256) {
        return price[market];
    }
}
