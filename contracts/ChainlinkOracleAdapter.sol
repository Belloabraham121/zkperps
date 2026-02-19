// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ChainlinkOracleAdapter
 * @notice Wraps Chainlink price feeds so PerpPositionManager can use them via IOracleAdapter.
 * @dev Register market -> feed with setFeed; getPriceWithFallback returns price in 18 decimals.
 *
 * Chainlink feed addresses (Arbitrum One):
 *   ETH/USD: 0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612
 *   BTC/USD: 0x6ce185860a4963106506C203335A291051365e6Ca
 *   More: https://docs.chain.link/data-feeds/price-feeds/addresses?network=arbitrum
 *
 * Chainlink feed addresses (Arbitrum Sepolia testnet):
 *   ETH/USD: https://docs.chain.link/data-feeds/price-feeds/addresses?network=arbitrum-sepolia
 */

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

contract ChainlinkOracleAdapter {
    uint256 public constant MAX_STALENESS = 1 hours;
    uint256 public constant PRECISION = 1e18;

    mapping(address => address) public feedByMarket; // market id => Chainlink aggregator

    event FeedSet(address indexed market, address feed);

    error FeedNotSet();
    error StalePrice();
    error InvalidPrice();

    /**
     * @param market Market id (e.g. address(0x1) for ETH).
     * @param feed Chainlink price feed (AggregatorV3) for that market.
     */
    function setFeed(address market, address feed) external {
        feedByMarket[market] = feed;
        emit FeedSet(market, feed);
    }

    /**
     * @notice Return price in 18 decimals for the given market. Reverts if feed not set or stale.
     */
    function getPriceWithFallback(address market) external view returns (uint256) {
        address feed = feedByMarket[market];
        if (feed == address(0)) revert FeedNotSet();

        (, int256 answer, , uint256 updatedAt, ) = IAggregatorV3(feed).latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        if (block.timestamp - updatedAt > MAX_STALENESS) revert StalePrice();

        uint8 dec = IAggregatorV3(feed).decimals();
        // Scale to 18 decimals
        if (dec >= 18) return uint256(answer) / (10 ** (dec - 18));
        return uint256(answer) * (10 ** (18 - dec));
    }
}
