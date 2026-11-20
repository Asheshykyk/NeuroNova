// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title BatchCommitmentVerifier
 * @notice Minimal Solidity contract using OpenZeppelin EIP712 + ECDSA to verify
 *         and recover signer address for TRUSTTRACE BatchCommitment typed data.
 * @dev Dependency: @openzeppelin/contracts (License: MIT)
 *
 * Domain includes:
 * - name: "EvidenceAnchor"
 * - version: "1"
 * - chainId: block.chainid
 * - verifyingContract: address(this)
 */
contract BatchCommitmentVerifier is EIP712 {
    using ECDSA for bytes32;

    struct BatchCommitment {
        bytes32 sourceId;
        uint64 sequenceStart;
        uint64 sequenceEnd;
        uint64 leafCount;
        bytes32 merkleRoot;
        bytes32 previousCheckpointHash;
    }

    bytes32 public constant BATCH_COMMITMENT_TYPEHASH = keccak256(
        "BatchCommitment(bytes32 sourceId,uint64 sequenceStart,uint64 sequenceEnd,uint64 leafCount,bytes32 merkleRoot,bytes32 previousCheckpointHash)"
    );

    constructor() EIP712("EvidenceAnchor", "1") {}

    /**
     * @notice Computes EIP-712 struct hash of a BatchCommitment.
     */
    function hashCommitment(BatchCommitment calldata commitment) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                BATCH_COMMITMENT_TYPEHASH,
                commitment.sourceId,
                commitment.sequenceStart,
                commitment.sequenceEnd,
                commitment.leafCount,
                commitment.merkleRoot,
                commitment.previousCheckpointHash
            )
        );
    }

    /**
     * @notice Computes full EIP-712 signing digest:
     *         keccak256("\x19\x01" || domainSeparator || hashCommitment(commitment))
     */
    function getDigest(BatchCommitment calldata commitment) public view returns (bytes32) {
        return _hashTypedDataV4(hashCommitment(commitment));
    }

    /**
     * @notice Recovers the signer address from an EIP-712 signature over a BatchCommitment.
     */
    function recoverSigner(
        BatchCommitment calldata commitment,
        bytes calldata signature
    ) public view returns (address) {
        bytes32 digest = getDigest(commitment);
        return digest.recover(signature);
    }

    /**
     * @notice Returns the EIP-712 domain separator computed by OpenZeppelin EIP712.
     */
    function domainSeparator() public view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
