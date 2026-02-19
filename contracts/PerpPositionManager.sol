// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "forge-std/interfaces/IERC20.sol";

/**
 * @title IOracleAdapter
 * @notice Price oracle interface for marking positions and funding (e.g. Chainlink adapter)
 */
interface IOracleAdapter {
    function getPriceWithFallback(address market) external view returns (uint256);
}

/**
 * @title PerpPositionManager
 * @notice Tracks perp positions, margin, funding, and liquidations. Called by PrivBatchHook after batch execution.
 */
contract PerpPositionManager {
    uint256 public constant PRECISION = 1e18;
    uint256 public constant FUNDING_PERIOD = 8 hours;

    struct Position {
        int256 size; // positive = long, negative = short (in base asset units, 18 decimals)
        uint256 entryPrice; // 18 decimals
        uint256 collateral; // margin allocated to this position, 18 decimals
        uint256 leverage; // 1e18 = 1x, 10e18 = 10x
        uint256 lastFundingPaid; // timestamp of last funding settlement
        int256 entryCumulativeFunding; // cumulative funding rate when position opened (18 decimals)
    }

    struct Market {
        bytes32 poolId; // Uniswap V4 pool id
        address indexOracle; // IOracleAdapter for price feed
        uint256 maxLeverage; // e.g. 10e18
        uint256 maintenanceMargin; // e.g. 0.05e18 = 5%
        uint256 lastFundingTime;
        int256 cumulativeFundingRate; // 18 decimals, updated each funding period
        bool isActive;
    }

    // ============ State ============
    IERC20 public immutable collateralToken;
    address public owner;
    address public executor; // PrivBatchHook or backend; only can open/close positions

    mapping(address => uint256) public totalCollateral; // user => deposited balance (18 decimals)
    mapping(address => mapping(address => Position)) public positions; // user => market => position
    mapping(address => Market) public markets; // market id (address) => config
    address[] public allMarkets;
    uint256 public insuranceFund; // 18 decimals

    // ============ Events ============
    event PositionOpened(address indexed user, address indexed market, int256 size, uint256 entryPrice, uint256 margin, uint256 leverage);
    event PositionClosed(address indexed user, address indexed market, int256 sizeClosed, uint256 markPrice, int256 realizedPnL);
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event MarketCreated(address indexed market, bytes32 poolId, address oracle, uint256 maxLeverage, uint256 maintenanceMargin);
    event MarketPaused(address indexed market);
    event MarketUnpaused(address indexed market);
    event FundingApplied(address indexed market, int256 rate, uint256 time);
    event PositionLiquidated(address indexed user, address indexed market, address liquidator);
    event InsuranceDeposit(uint256 amount);
    event ExecutorSet(address indexed previous, address indexed current);
    event OwnerSet(address indexed previous, address indexed current);

    // ============ Errors ============
    error OnlyOwner();
    error OnlyExecutor();
    error MarketNotActive();
    error MarketAlreadyExists();
    error MarketNotFound();
    error InsufficientMargin();
    error InsufficientCollateral();
    error InvalidLeverage();
    error InvalidSize();
    error InvalidAmount();
    error PositionNotFound();
    error NotLiquidatable();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }
    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    constructor(IERC20 _collateralToken, address _owner, address _executor) {
        collateralToken = _collateralToken;
        owner = _owner;
        executor = _executor;
    }

    // ============ Admin ============
    function setOwner(address _owner) external onlyOwner {
        address prev = owner;
        owner = _owner;
        emit OwnerSet(prev, _owner);
    }

    function setExecutor(address _executor) external onlyOwner {
        address prev = executor;
        executor = _executor;
        emit ExecutorSet(prev, _executor);
    }

    // ============ Market management ============
    function createMarket(
        address market,
        bytes32 poolId,
        address indexOracle,
        uint256 maxLeverage,
        uint256 maintenanceMargin
    ) external onlyOwner {
        if (markets[market].indexOracle != address(0)) revert MarketAlreadyExists();
        if (maxLeverage == 0 || maintenanceMargin >= PRECISION) revert InvalidLeverage();
        markets[market] = Market({
            poolId: poolId,
            indexOracle: indexOracle,
            maxLeverage: maxLeverage,
            maintenanceMargin: maintenanceMargin,
            lastFundingTime: block.timestamp,
            cumulativeFundingRate: 0,
            isActive: true
        });
        allMarkets.push(market);
        emit MarketCreated(market, poolId, indexOracle, maxLeverage, maintenanceMargin);
    }

    function setMaxLeverage(address market, uint256 maxLeverage) external onlyOwner {
        if (markets[market].indexOracle == address(0)) revert MarketNotFound();
        markets[market].maxLeverage = maxLeverage;
    }

    function pauseMarket(address market) external onlyOwner {
        if (markets[market].indexOracle == address(0)) revert MarketNotFound();
        markets[market].isActive = false;
        emit MarketPaused(market);
    }

    function unpauseMarket(address market) external onlyOwner {
        if (markets[market].indexOracle == address(0)) revert MarketNotFound();
        markets[market].isActive = true;
        emit MarketUnpaused(market);
    }

    // ============ Margin (user-facing) ============
    /**
     * @notice Deposit collateral. Amount in token decimals (e.g. 6 for USDC). Caller must approve this contract.
     */
    function depositCollateral(address user, uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        uint256 amount18 = _to18(amount);
        collateralToken.transferFrom(msg.sender, address(this), amount);
        totalCollateral[user] += amount18;
        emit CollateralDeposited(user, amount18);
    }

    /**
     * @notice Withdraw collateral. Only up to available margin. Amount in token decimals. Only callable by user for self.
     */
    function withdrawCollateral(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        address user = msg.sender;
        uint256 amount18 = _to18(amount);
        if (getAvailableMargin(user) < amount18) revert InsufficientMargin();
        totalCollateral[user] -= amount18;
        _transferOut(user, amount18);
        emit CollateralWithdrawn(user, amount18);
    }

    function getAvailableMargin(address user) public view returns (uint256) {
        uint256 used = getUsedMargin(user);
        uint256 total = totalCollateral[user];
        return total > used ? total - used : 0;
    }

    function getUsedMargin(address user) public view returns (uint256) {
        uint256 used;
        for (uint256 i; i < allMarkets.length; i++) {
            Position storage pos = positions[user][allMarkets[i]];
            if (pos.size != 0) used += pos.collateral;
        }
        return used;
    }

    function getTotalCollateral(address user) external view returns (uint256) {
        return totalCollateral[user];
    }

    // ============ Position management (executor only) ============
    /**
     * @param size Magnitude of position in base asset (18 decimals). Sign set by isLong.
     * @param entryPrice Price at open (18 decimals).
     */
    function openPosition(
        address user,
        address market,
        uint256 size,
        bool isLong,
        uint256 leverage,
        uint256 entryPrice
    ) external onlyExecutor {
        if (!markets[market].isActive) revert MarketNotActive();
        if (size == 0) revert InvalidSize();
        Market storage m = markets[market];
        if (leverage > m.maxLeverage || leverage == 0) revert InvalidLeverage();

        uint256 notional = (size * entryPrice) / PRECISION;
        uint256 requiredMargin = (notional * PRECISION) / leverage; // keep margin in 18 decimals
        if (getAvailableMargin(user) < requiredMargin) revert InsufficientMargin();

        int256 signedSize = isLong ? int256(size) : -int256(size);
        Position storage pos = positions[user][market];

        if (pos.size == 0) {
            pos.size = signedSize;
            pos.entryPrice = entryPrice;
            pos.collateral = requiredMargin;
            pos.leverage = leverage;
            pos.lastFundingPaid = block.timestamp;
            pos.entryCumulativeFunding = m.cumulativeFundingRate;
        } else {
            // same direction: add to position (average entry)
            if ((pos.size > 0 && !isLong) || (pos.size < 0 && isLong)) revert InvalidSize(); // mixed direction not supported in one call
            uint256 oldNotional = (uint256(pos.size > 0 ? pos.size : -pos.size) * pos.entryPrice) / PRECISION;
            pos.entryPrice = ((oldNotional * pos.entryPrice) + (size * entryPrice)) / (oldNotional + notional);
            pos.size += signedSize;
            pos.collateral += requiredMargin;
            pos.leverage = leverage; // use new leverage
        }

        emit PositionOpened(user, market, signedSize, entryPrice, requiredMargin, leverage);
    }

    /**
     * @param sizeToClose Magnitude of size to close (18 decimals).
     * @param markPrice Current price for PnL (18 decimals).
     */
    function closePosition(address user, address market, uint256 sizeToClose, uint256 markPrice) external onlyExecutor {
        _closePosition(user, market, sizeToClose, markPrice);
    }

    function _closePosition(address user, address market, uint256 sizeToClose, uint256 markPrice) internal {
        if (sizeToClose == 0) revert InvalidSize();
        Position storage pos = positions[user][market];
        if (pos.size == 0) revert PositionNotFound();

        _settleFunding(user, market);
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        if (sizeToClose > absSize) sizeToClose = absSize;

        int256 signedClose = pos.size > 0 ? int256(sizeToClose) : -int256(sizeToClose);
        int256 realizedPnL;
        if (pos.size > 0) {
            realizedPnL = (int256(sizeToClose) * (int256(markPrice) - int256(pos.entryPrice))) / int256(PRECISION);
        } else {
            realizedPnL = (int256(sizeToClose) * (int256(pos.entryPrice) - int256(markPrice))) / int256(PRECISION);
        }

        int256 newCollateralPos = int256(pos.collateral) + realizedPnL;
        pos.collateral = newCollateralPos > 0 ? uint256(newCollateralPos) : 0;
        pos.size -= signedClose;

        if (pos.size == 0) {
            totalCollateral[user] += pos.collateral;
            pos.collateral = 0;
            pos.entryPrice = 0;
            pos.leverage = 0;
            pos.entryCumulativeFunding = 0;
        }

        emit PositionClosed(user, market, signedClose, markPrice, realizedPnL);
    }

    function getPosition(address user, address market) external view returns (
        int256 size,
        uint256 entryPrice,
        uint256 collateral,
        uint256 leverage,
        uint256 lastFundingPaid,
        int256 entryCumulativeFunding
    ) {
        Position storage pos = positions[user][market];
        return (pos.size, pos.entryPrice, pos.collateral, pos.leverage, pos.lastFundingPaid, pos.entryCumulativeFunding);
    }

    function getUnrealizedPnL(address user, address market) external view returns (int256) {
        Position storage pos = positions[user][market];
        if (pos.size == 0) return 0;
        uint256 markPrice = IOracleAdapter(markets[market].indexOracle).getPriceWithFallback(market);
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        if (pos.size > 0) {
            return (int256(absSize) * (int256(markPrice) - int256(pos.entryPrice))) / int256(PRECISION);
        } else {
            return (int256(absSize) * (int256(pos.entryPrice) - int256(markPrice))) / int256(PRECISION);
        }
    }

    function getLiquidationPrice(address user, address market) external view returns (uint256) {
        Position storage pos = positions[user][market];
        if (pos.size == 0) return 0;
        Market storage m = markets[market];
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        // equity = collateral + unrealizedPnL; liquidate when equity / notional <= maintenanceMargin
        // For long: equity = collateral + size*(markPrice - entryPrice). notional = size*markPrice.
        // collateral + size*markPrice - size*entryPrice <= mm*size*markPrice => markPrice <= (size*entryPrice - collateral) / (size*(1-mm))
        if (pos.size > 0) {
            uint256 num = (absSize * pos.entryPrice) / PRECISION;
            if (num <= pos.collateral) return 0; // already underwater or no liquidation price
            uint256 ratio = (num - pos.collateral) * PRECISION / (absSize * (PRECISION - m.maintenanceMargin));
            return ratio * PRECISION; // price in 18 decimals
        } else {
            // short: equity = collateral + size*(entryPrice - markPrice). notional = size*markPrice.
            uint256 num = (absSize * pos.entryPrice) / PRECISION + pos.collateral;
            uint256 ratio = (num * PRECISION) / (absSize * (PRECISION + m.maintenanceMargin));
            return ratio * PRECISION; // price in 18 decimals
        }
    }

    // ============ Funding ============
    function calculateFundingRate(address market) external view returns (int256) {
        // Oracle vs AMM: caller or separate contract can compute; here we just expose for keeper
        return markets[market].cumulativeFundingRate;
    }

    /**
     * @notice Apply funding for a market. Keeper calls with precomputed rate (oracle - amm) / amm in 18 decimals.
     */
    function applyFunding(address market, int256 rateDelta) external onlyOwner {
        Market storage m = markets[market];
        if (m.indexOracle == address(0)) revert MarketNotFound();
        m.cumulativeFundingRate += rateDelta;
        m.lastFundingTime = block.timestamp;
        emit FundingApplied(market, rateDelta, block.timestamp);
    }

    function getNextFundingTime(address market) external view returns (uint256) {
        Market storage m = markets[market];
        if (m.lastFundingTime == 0) return 0;
        return ((m.lastFundingTime / FUNDING_PERIOD) + 1) * FUNDING_PERIOD;
    }

    function getFundingPayment(address user, address market) external view returns (int256) {
        Position storage pos = positions[user][market];
        if (pos.size == 0) return 0;
        Market storage m = markets[market];
        int256 delta = m.cumulativeFundingRate - pos.entryCumulativeFunding;
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        uint256 notional = (absSize * pos.entryPrice) / PRECISION;
        // payment: positive = user pays. For long (size>0), if delta>0, long pays so payment positive.
        return (int256(notional) * delta) / int256(PRECISION);
    }

    function _settleFunding(address user, address market) internal {
        Position storage pos = positions[user][market];
        if (pos.size == 0) return;
        Market storage m = markets[market];
        int256 delta = m.cumulativeFundingRate - pos.entryCumulativeFunding;
        pos.entryCumulativeFunding = m.cumulativeFundingRate;
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        uint256 notional = (absSize * pos.entryPrice) / PRECISION;
        int256 payment = (int256(notional) * delta) / int256(PRECISION);
        int256 newCollateral = int256(pos.collateral) - payment;
        pos.collateral = newCollateral > 0 ? uint256(newCollateral) : 0;
    }

    // ============ Liquidation ============
    function checkLiquidation(address user, address market) public view returns (bool) {
        Position storage pos = positions[user][market];
        if (pos.size == 0) return false;
        uint256 markPrice = IOracleAdapter(markets[market].indexOracle).getPriceWithFallback(market);
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        uint256 notional = (absSize * markPrice) / PRECISION;
        int256 pnl;
        if (pos.size > 0) pnl = (int256(absSize) * (int256(markPrice) - int256(pos.entryPrice))) / int256(PRECISION);
        else pnl = (int256(absSize) * (int256(pos.entryPrice) - int256(markPrice))) / int256(PRECISION);
        int256 equitySigned = int256(pos.collateral) + pnl;
        uint256 equity = equitySigned > 0 ? uint256(equitySigned) : 0;
        return notional > 0 && (equity * PRECISION) / notional <= markets[market].maintenanceMargin;
    }

    function liquidatePosition(address user, address market) external {
        if (!checkLiquidation(user, market)) revert NotLiquidatable();
        Position storage pos = positions[user][market];
        uint256 absSize = pos.size > 0 ? uint256(pos.size) : uint256(-pos.size);
        uint256 markPrice = IOracleAdapter(markets[market].indexOracle).getPriceWithFallback(market);
        int256 realizedPnL;
        if (pos.size > 0) realizedPnL = (int256(absSize) * (int256(markPrice) - int256(pos.entryPrice))) / int256(PRECISION);
        else realizedPnL = (int256(absSize) * (int256(pos.entryPrice) - int256(markPrice))) / int256(PRECISION);
        int256 collateralFreedSigned = int256(pos.collateral) + realizedPnL;
        uint256 collateralFreed = collateralFreedSigned > 0 ? uint256(collateralFreedSigned) : 0;
        uint256 fee = (collateralFreed * 5) / 100; // 5% to insurance
        _closePosition(user, market, absSize, markPrice);
        if (fee > 0 && totalCollateral[user] >= fee) {
            totalCollateral[user] -= fee;
            insuranceFund += fee;
        }
        emit PositionLiquidated(user, market, msg.sender);
    }

    function getInsuranceFund() external view returns (uint256) {
        return insuranceFund;
    }

    function depositToInsuranceFund(uint256 amount) external onlyOwner {
        if (amount == 0) revert InvalidAmount();
        uint256 amount18 = _to18(amount);
        collateralToken.transferFrom(msg.sender, address(this), amount);
        insuranceFund += amount18;
        emit InsuranceDeposit(amount18);
    }

    // ============ Helpers ============
    function _to18(uint256 amount) internal view returns (uint256) {
        uint8 d = _decimals();
        if (d >= 18) return amount / (10 ** (d - 18));
        return amount * (10 ** (18 - d));
    }

    function _from18(uint256 amount18) internal view returns (uint256) {
        uint8 d = _decimals();
        if (d >= 18) return amount18 * (10 ** (d - 18));
        return amount18 / (10 ** (18 - d));
    }

    function _decimals() internal view returns (uint8) {
        (bool ok, bytes memory data) = address(collateralToken).staticcall(abi.encodeWithSignature("decimals()"));
        return ok && data.length >= 32 ? abi.decode(data, (uint8)) : 18;
    }

    function _transferOut(address to, uint256 amount) internal {
        uint256 raw = _from18(amount);
        if (raw == 0) return;
        bool ok = collateralToken.transfer(to, raw);
        if (!ok) revert TransferFailed();
    }
}
