# ZK Circuit for Commitment Proof

## Overview

This circuit implements a zero-knowledge proof that allows users to prove knowledge of the pre-image (trade parameters) that hashes to a given `commitmentHash` without revealing the parameters themselves.

## Circuit Design

### Purpose
Prove: `Poseidon(user, tokenIn, tokenOut, amountIn, minAmountOut, recipient, nonce, deadline) == commitmentHash`

### Inputs

**Private Inputs (Hidden)**:
- `user`: User address (converted to field element)
- `tokenIn`: Input token address (converted to field element)
- `tokenOut`: Output token address (converted to field element)
- `amountIn`: Input amount (uint256)
- `minAmountOut`: Minimum output amount (uint256)
- `recipient`: Recipient address (converted to field element)
- `nonce`: Nonce for uniqueness (uint256)
- `deadline`: Deadline timestamp (uint256)

**Public Input (Visible)**:
- `commitmentHash`: The commitment hash that must match

### Why Poseidon Hash?

- **ZK-Friendly**: Poseidon is designed for zero-knowledge proofs
- **Efficient**: Much cheaper gas costs (~150-250k vs ~500k+ for Keccak256)
- **Fast**: Faster proof generation and verification
- **Standard**: Widely used in ZK applications (circomlib)

### Address Handling

Ethereum addresses (20 bytes, 160 bits) need to be converted to field elements for Poseidon. In JavaScript/TypeScript proof generation:

```javascript
// Convert address to BigInt (field element)
const userField = BigInt(userAddress);
const tokenInField = BigInt(tokenInAddress);
// ... etc
```

The field modulus for BN128 is ~254 bits, so addresses fit comfortably.

## Compilation

```bash
# Compile circuit
circom circuits/commitment-proof.circom --r1cs --wasm --sym -o build/zk

# This generates:
# - build/zk/commitment-proof.r1cs (constraint system)
# - build/zk/commitment-proof.wasm (witness calculator)
# - build/zk/commitment-proof.sym (symbols for debugging)
```

## Trusted Setup

```bash
# Generate powers of tau (12 = 2^12 = 4096 constraints max)
snarkjs powersoftau new bn128 12 pot12_0000.ptau

# Contribute to ptau (for security)
snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name="first" -v

# Setup Groth16
snarkjs groth16 setup build/zk/commitment-proof.r1cs pot12_0001.ptau build/zk/zkey_0000.zkey

# Contribute to zkey (for security)
snarkjs zkey contribute build/zk/zkey_0000.zkey build/zk/final.zkey --name="final" -v

# Export verification key
snarkjs zkey export verificationkey build/zk/final.zkey build/zk/vkey.json
```

## Verifier Generation

```bash
# Generate Solidity verifier contract
snarkjs zkey export solidityverifier build/zk/final.zkey contracts/CommitmentVerifier.sol
```

## Proof Generation

See `scripts/zk/generate-proof.js` for proof generation example.

## Integration

The verifier contract will be integrated into `PrivBatchHook.sol` to verify proofs instead of processing plaintext reveals.

## Privacy Guarantees

- ✅ Trade parameters are hidden in the proof
- ✅ Only commitmentHash is public
- ✅ Verifier can check proof validity without seeing trade details
- ✅ Users can prove commitment validity without revealing intent

## Gas Costs

- Proof verification: ~150-250k gas (Poseidon is efficient)
- Proof generation: ~1-4 seconds (off-chain)

## Next Steps

1. Complete trusted setup
2. Generate verifier contract
3. Integrate verifier into PrivBatchHook
4. Update reveal functions to accept proofs instead of plaintext
