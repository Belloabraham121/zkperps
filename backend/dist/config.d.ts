import "dotenv/config";
export declare const config: {
    port: number;
    nodeEnv: string;
    jwtSecret: string;
    jwtExpiresIn: string;
    privy: {
        appId: string;
        appSecret: string;
        keyQuorumId: string;
        authorizationPrivateKeyPath: string;
    };
    chainId: number;
    rpcUrl: string;
    baseIsCurrency0: boolean;
    contracts: {
        /** Uniswap V4 PoolManager (Arbitrum Sepolia); used to read pool slot0 for debug. */
        poolManager: `0x${string}`;
        privBatchHook: `0x${string}`;
        perpPositionManager: `0x${string}`;
        mockUsdc: `0x${string}`;
        mockUsdt: `0x${string}`;
        marketId: `0x${string}`;
    };
    mongodb: {
        uri: string;
        dbName: string;
    };
    /** Optional. If set, a background keeper will auto-execute perp batches when ready. */
    keeper: {
        /** Privy user ID (e.g. did:privy:...) of the wallet that sends execute-batch txs. Must have wallet linked and addSigners done. */
        privyUserId: string;
        /** How often to check (ms). Default 60_000 (1 min). */
        intervalMs: number;
        /** Max commitments per batch (0 = no limit). Use e.g. 2 to test; contract may revert with large batches (e.g. InsufficientMargin on one intent). */
        maxPerpBatchSize: number;
    };
};
//# sourceMappingURL=config.d.ts.map