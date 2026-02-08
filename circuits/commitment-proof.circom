// SPDX-License-Identifier: MIT
pragma circom 2.1.6;

// Circuit to prove knowledge of commitment hash pre-image
// This circuit proves: Poseidon(user, tokenIn, tokenOut, amountIn, minAmountOut, recipient, nonce, deadline) == commitmentHash
// Private inputs: All trade parameters (hidden)
// Public input: commitmentHash only (visible)

include "circomlib/poseidon.circom";

template CommitmentProof() {
    // Private inputs (hidden - these are the trade parameters)
    signal input user;           // User address (as field element)
    signal input tokenIn;        // Input token address (as field element)
    signal input tokenOut;       // Output token address (as field element)
    signal input amountIn;       // Input amount
    signal input minAmountOut;   // Minimum output amount
    signal input recipient;      // Recipient address (as field element)
    signal input nonce;          // Nonce for uniqueness
    signal input deadline;       // Deadline timestamp
    
    // Public output (visible - this is the commitment hash)
    signal output commitmentHash;
    
    // Poseidon hash with 8 inputs (one for each parameter)
    // Poseidon is ZK-friendly and much cheaper than Keccak256 in ZK proofs
    component poseidon = Poseidon(8);
    
    // Connect inputs to Poseidon hash
    poseidon.inputs[0] <== user;
    poseidon.inputs[1] <== tokenIn;
    poseidon.inputs[2] <== tokenOut;
    poseidon.inputs[3] <== amountIn;
    poseidon.inputs[4] <== minAmountOut;
    poseidon.inputs[5] <== recipient;
    poseidon.inputs[6] <== nonce;
    poseidon.inputs[7] <== deadline;
    
    // Output the hash
    commitmentHash <== poseidon.out;
}

// Main component with public commitmentHash
// The commitmentHash is public so the verifier can check it matches the on-chain commitment
component main {public [commitmentHash]} = CommitmentProof();
