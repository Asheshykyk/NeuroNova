// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EvidenceAnchor
 * @notice Anchors tamper-evident security evidence commitments to EVM blockchains.
 * @dev Core smart contract for TRUSTTRACE (The Big Hack 2.0 | Track 02 | Problem B3).
 * 
 * OWNED BY: Person 1 (branch feature/crypto-contract)
 *
 * LOCKED SPECIFICATIONS:
 * 1. leafHash = SHA256(0x00 || version || sourceId || vaultSequence || rawEventLength || rawEventBytes);
 * 2. node = SHA256(0x01 || left || right); odd node promoted unchanged (never duplicated);
 * 3. commitment binds sourceId, sequenceStart, sequenceEnd, leafCount, merkleRoot, previousCheckpointHash.
 * 4. Contract: anchorBatch() + BatchAnchored event; validates registered signer, source, sequence
 *    continuity, duplicate batches. EIP-712 signer key exists ONLY in the vault; relayer is a separate key.
 *
 * ASSUMPTIONS (unconfirmed, labeled in code):
 * - A1 widths: version 1B, sourceId 32B, vaultSequence u64 BE, rawEventLength u32 BE
 * - A2: sourceId bytes32
 * - A3: previousCheckpointHash = struct hash of previous commitment, genesis zero, first batch starts at seq 1
 * - A4: same contract on Amoy, checkpoint digest in merkleRoot field
 * - A5: owner registers/revokes sources, no overwrite/delete function
 */
contract EvidenceAnchor {
    // -------------------------------------------------------------------------
    // Data Structures & EIP-712 Typehashes
    // -------------------------------------------------------------------------

    /// @dev ASSUMPTIONS A1, A2, A3, A4:
    /// - sourceId: bytes32 (A1, A2)
    /// - sequenceStart, sequenceEnd, leafCount: uint64 (A1)
    /// - merkleRoot: bytes32 (stores batch Merkle root or Amoy checkpoint digest, A4)
    /// - previousCheckpointHash: bytes32 (struct hash of previous batch, zero for genesis, A3)
    struct BatchCommitment {
        bytes32 sourceId;
        uint64 sequenceStart;
        uint64 sequenceEnd;
        uint64 leafCount;
        bytes32 merkleRoot;
        bytes32 previousCheckpointHash;
    }

    struct SourceInfo {
        address signer;
        bool registered;
        bool revoked;
        uint64 lastSequenceEnd;
        bytes32 lastCheckpointHash;
        uint256 batchCount;
    }

    bytes32 public constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    bytes32 public constant BATCH_COMMITMENT_TYPEHASH = keccak256(
        "BatchCommitment(bytes32 sourceId,uint64 sequenceStart,uint64 sequenceEnd,uint64 leafCount,bytes32 merkleRoot,bytes32 previousCheckpointHash)"
    );

    bytes32 public constant DOMAIN_NAME_HASH = keccak256("EvidenceAnchor");
    bytes32 public constant DOMAIN_VERSION_HASH = keccak256("1");

    // -------------------------------------------------------------------------
    // State Variables
    // -------------------------------------------------------------------------

    address public owner;
    uint256 private immutable _initialChainId;
    bytes32 private immutable _initialDomainSeparator;

    /// @notice Source registration registry (bytes32 sourceId => SourceInfo)
    mapping(bytes32 => SourceInfo) public sources;

    /// @notice Set of anchored commitment struct hashes (duplicate batch prevention)
    mapping(bytes32 => bool) public anchoredBatches;

    /// @notice Stored commitments indexed by struct hash
    mapping(bytes32 => BatchCommitment) public batches;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted whenever a batch is successfully anchored on-chain.
    event BatchAnchored(
        bytes32 indexed sourceId,
        uint64 sequenceStart,
        uint64 sequenceEnd,
        uint64 leafCount,
        bytes32 merkleRoot,
        bytes32 previousCheckpointHash,
        bytes32 indexed commitmentHash,
        address signer,
        address relayer,
        uint256 timestamp
    );

    event SourceRegistered(bytes32 indexed sourceId, address indexed signer);
    event SourceRevoked(bytes32 indexed sourceId);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "Caller is not contract owner");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor() {
        owner = msg.sender;
        _initialChainId = block.chainid;
        _initialDomainSeparator = _buildDomainSeparator();
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // -------------------------------------------------------------------------
    // Source Management (ASSUMPTION A5)
    // -------------------------------------------------------------------------

    /**
     * @notice Registers an authorised EIP-712 signer for a given source.
     * @dev ASSUMPTION A5: Owner registers sources. Overwrite is explicitly rejected.
     *      No delete function exists.
     * @param sourceId The 32-byte identifier of the source (A2).
     * @param signer The authorised vault signer address for this source.
     */
    function registerSource(bytes32 sourceId, address signer) external onlyOwner {
        require(sourceId != bytes32(0), "Invalid sourceId: zero bytes");
        require(signer != address(0), "Invalid signer address: zero address");
        // ASSUMPTION A5: no overwrite function
        require(!sources[sourceId].registered, "Source already registered; overwrite not permitted (A5)");

        sources[sourceId] = SourceInfo({
            signer: signer,
            registered: true,
            revoked: false,
            lastSequenceEnd: 0,
            lastCheckpointHash: bytes32(0),
            batchCount: 0
        });

        emit SourceRegistered(sourceId, signer);
    }

    /**
     * @notice Revokes an authorised source.
     * @dev ASSUMPTION A5: Sources can be revoked by owner, but never deleted or overwritten.
     * @param sourceId The 32-byte identifier of the source to revoke.
     */
    function revokeSource(bytes32 sourceId) external onlyOwner {
        require(sources[sourceId].registered, "Source not registered");
        require(!sources[sourceId].revoked, "Source is already revoked");

        sources[sourceId].revoked = true;
        emit SourceRevoked(sourceId);
    }

    /**
     * @notice Transfers ownership of the contract.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner cannot be zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // -------------------------------------------------------------------------
    // Batch Anchoring (LOCKED SPECIFICATIONS)
    // -------------------------------------------------------------------------

    /**
     * @notice Anchors an evidence batch commitment with an EIP-712 vault signature.
     * @dev Validates registered signer, source status, sequence continuity, and duplicate batches.
     *      LOCKED: EIP-712 signer key exists ONLY in vault; relayer is a separate key (msg.sender).
     * @param commitment The batch commitment struct.
     * @param signature The 65-byte EIP-712 signature produced by the vault signer.
     * @return commitmentHash The EIP-712 struct hash of the anchored commitment.
     */
    function anchorBatch(
        BatchCommitment calldata commitment,
        bytes calldata signature
    ) external returns (bytes32 commitmentHash) {
        require(signature.length == 65, "Invalid signature length: expected 65 bytes");

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        return _anchorBatch(commitment, v, r, s);
    }

    /**
     * @notice Convenience overload to anchor a batch with explicit v, r, s signature components.
     */
    function anchorBatchWithVRS(
        BatchCommitment calldata commitment,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (bytes32 commitmentHash) {
        return _anchorBatch(commitment, v, r, s);
    }

    /**
     * @dev Internal batch anchoring logic enforcing all locked rules and assumptions.
     */
    function _anchorBatch(
        BatchCommitment calldata commitment,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal returns (bytes32 commitmentHash) {
        // 1. Source Validation
        SourceInfo storage source = sources[commitment.sourceId];
        require(source.registered, "Source not registered");
        require(!source.revoked, "Source is revoked");

        // 2. Duplicate Batch Check
        commitmentHash = hashCommitment(commitment);
        require(!anchoredBatches[commitmentHash], "Duplicate batch: commitment already anchored");

        // 3. EIP-712 Signer Validation
        // LOCKED: EIP-712 signer key exists ONLY in vault; relayer is a separate key (msg.sender).
        bytes32 digest = getDigest(commitment);
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid signature recovery id v");
        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "Invalid signature s-value: malleability protection"
        );

        address recoveredSigner = ecrecover(digest, v, r, s);
        require(recoveredSigner != address(0), "ecrecover failed: invalid signature");
        require(recoveredSigner == source.signer, "Invalid signer: does not match registered vault signer");

        // 4. Sequence Continuity Validation
        require(commitment.sequenceStart <= commitment.sequenceEnd, "Invalid sequence: start > end");
        uint64 expectedLeafCount = commitment.sequenceEnd - commitment.sequenceStart + 1;
        require(commitment.leafCount == expectedLeafCount, "leafCount mismatch with sequence range");

        // ASSUMPTION A3: previousCheckpointHash = struct hash of previous commitment, genesis zero, first batch starts at seq 1
        if (source.batchCount == 0) {
            require(commitment.sequenceStart == 1, "First batch must start at sequence 1 (A3)");
            require(commitment.previousCheckpointHash == bytes32(0), "Genesis previousCheckpointHash must be zero (A3)");
        } else {
            require(
                commitment.sequenceStart == source.lastSequenceEnd + 1,
                "Sequence continuity broken: sequenceStart != lastSequenceEnd + 1"
            );
            require(
                commitment.previousCheckpointHash == source.lastCheckpointHash,
                "previousCheckpointHash mismatch: does not match previous commitment struct hash (A3)"
            );
        }

        // 5. State Updates (Append-only: commitments cannot be modified or deleted)
        anchoredBatches[commitmentHash] = true;
        batches[commitmentHash] = commitment;
        source.lastSequenceEnd = commitment.sequenceEnd;
        source.lastCheckpointHash = commitmentHash;
        source.batchCount += 1;

        // 6. Emit BatchAnchored event
        emit BatchAnchored(
            commitment.sourceId,
            commitment.sequenceStart,
            commitment.sequenceEnd,
            commitment.leafCount,
            commitment.merkleRoot,
            commitment.previousCheckpointHash,
            commitmentHash,
            recoveredSigner,
            msg.sender, // Relayer address
            block.timestamp
        );
    }

    // -------------------------------------------------------------------------
    // Verification & Read-Only Getters
    // -------------------------------------------------------------------------

    /**
     * @notice Computes the EIP-712 struct hash of a BatchCommitment.
     * @dev LOCKED: commitment binds sourceId, sequenceStart, sequenceEnd, leafCount, merkleRoot, previousCheckpointHash.
     */
    function hashCommitment(BatchCommitment calldata commitment) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                BATCH_COMMITMENT_TYPEHASH,
                commitment.sourceId,
                uint256(commitment.sequenceStart),
                uint256(commitment.sequenceEnd),
                uint256(commitment.leafCount),
                commitment.merkleRoot,
                commitment.previousCheckpointHash
            )
        );
    }

    /**
     * @notice Computes the full EIP-712 signing digest for a BatchCommitment.
     */
    function getDigest(BatchCommitment calldata commitment) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(),
                hashCommitment(commitment)
            )
        );
    }

    /**
     * @notice Returns the active EIP-712 domain separator (handles chain forks/ID changes).
     */
    function domainSeparator() public view returns (bytes32) {
        if (block.chainid == _initialChainId) {
            return _initialDomainSeparator;
        }
        return _buildDomainSeparator();
    }

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                DOMAIN_NAME_HASH,
                DOMAIN_VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
    }

    /**
     * @notice Returns latest batch commitment and hash for a source.
     */
    function getLatest(bytes32 sourceId)
        public
        view
        returns (BatchCommitment memory commitment, bytes32 commitmentHash)
    {
        SourceInfo storage source = sources[sourceId];
        require(source.registered, "Source not registered");
        require(source.batchCount > 0, "No batches anchored for source");

        commitmentHash = source.lastCheckpointHash;
        commitment = batches[commitmentHash];
    }

    /**
     * @notice Backward-compatible alias for getLatest.
     */
    function getLatestBatch(bytes32 sourceId)
        external
        view
        returns (BatchCommitment memory commitment, bytes32 commitmentHash)
    {
        return getLatest(sourceId);
    }

    /**
     * @notice Returns full source metadata and continuity state.
     */
    function getSource(bytes32 sourceId)
        external
        view
        returns (
            address signer,
            bool registered,
            bool revoked,
            uint64 lastSequenceEnd,
            bytes32 lastCheckpointHash,
            uint256 batchCount
        )
    {
        SourceInfo storage source = sources[sourceId];
        return (
            source.signer,
            source.registered,
            source.revoked,
            source.lastSequenceEnd,
            source.lastCheckpointHash,
            source.batchCount
        );
    }

    /**
     * @notice Returns a stored commitment by its struct hash.
     */
    function getBatch(bytes32 commitmentHash) public view returns (BatchCommitment memory) {
        require(anchoredBatches[commitmentHash], "Batch commitment not found");
        return batches[commitmentHash];
    }

    /**
     * @notice Backward-compatible alias for getBatch.
     */
    function getBatchByHash(bytes32 commitmentHash) external view returns (BatchCommitment memory) {
        return getBatch(commitmentHash);
    }

    /**
     * @notice Checks if a commitment struct hash has been anchored.
     */
    function isBatchAnchored(bytes32 commitmentHash) external view returns (bool) {
        return anchoredBatches[commitmentHash];
    }

    /**
     * @notice Verifies an inclusion proof on-chain using SHA-256 and the locked odd promotion rule.
     * @dev LOCKED: node = SHA256(0x01 || left || right); odd node promoted unchanged (never duplicated);
     *      A promoted step is passed as bytes32(0).
     */
    function verifyInclusionProof(
        bytes32 leafHash,
        bytes32[] calldata proof,
        uint256 index,
        bytes32 expectedRoot
    ) external pure returns (bool) {
        bytes32 current = leafHash;
        uint256 idx = index;

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            if (sibling == bytes32(0)) {
                // Odd node promoted unchanged (no sibling)
            } else if (idx % 2 == 1) {
                // Current is right child, sibling on left
                current = sha256(abi.encodePacked(bytes1(0x01), sibling, current));
            } else {
                // Current is left child, sibling on right
                current = sha256(abi.encodePacked(bytes1(0x01), current, sibling));
            }
            idx = idx / 2;
        }

        return current == expectedRoot;
    }
}
