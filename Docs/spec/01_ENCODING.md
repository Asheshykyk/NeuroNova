# TRUSTTRACE Canonical Event Encoding & Merkle Tree Specification

**Specification Version:** 1  
**Project:** TRUSTTRACE (The Big Hack 2.0 | Track 02: Cybersecurity and Blockchain | Problem B3)  
**Workstream:** Person 1 (`feature/crypto-contract`)  
**Status:** Frozen Interface Contract (H0–H2 Milestone)

---

## 1. Scope & Purpose

This specification defines the exact wire encoding, cryptographic hashing, and Merkle tree conventions used across all four TRUSTTRACE components:
1. **Host Agent (`feature/host-lab-agent`):** Canonical payload construction.
2. **Evidence Vault (`feature/vault-backend`):** Raw byte storage, vault sequence assignment, and batch Merkle tree generation.
3. **Smart Contract (`feature/crypto-contract`):** On-chain commitment and Merkle verification (`EvidenceAnchor.sol`).
4. **Auditor Verifier / Dashboard (`feature/dashboard-verifier`):** Independent offline and browser verification against public RPC.

---

## 2. Domain Separation Tags

To prevent second-preimage attacks and ambiguity between tree leaves and internal nodes, cryptographic domain separation tags are prepended to every hash preimage:

| Target | Domain Tag Byte | Hex | Purpose |
| :--- | :--- | :--- | :--- |
| **Leaf Preimage** | `0x00` | `0x00` | Distinguishes canonical raw event leaves from internal nodes |
| **Internal Node** | `0x01` | `0x01` | Distinguishes internal branch nodes from leaves |

---

## 3. Canonical Leaf Byte Layout

### 3.1 Preimage Layout

Every event is converted into a deterministic binary preimage prior to leaf hashing:

$$\text{leafPreimage} = \mathtt{0x00} \parallel \text{version} \parallel \text{sourceId} \parallel \text{vaultSequence} \parallel \text{rawEventLength} \parallel \text{rawEventBytes}$$

### 3.2 Field Definitions & Widths (ASSUMPTION A1 & A2)

| Field | Width | Type / Endianness | Description |
| :--- | :--- | :--- | :--- |
| **Domain Tag** | 1 byte | Literal `0x00` | Leaf domain separation tag |
| **version** | 1 byte | `uint8` (unsigned 8-bit integer) | Schema version (currently `1` = `0x01`) |
| **sourceId** | 32 bytes | `bytes32` (binary / right-padded ASCII) | 32-byte identifier of the monitored source / host |
| **vaultSequence** | 8 bytes | `uint64` (Big-Endian, unsigned 64-bit integer) | Strictly monotonic vault-assigned receipt sequence number |
| **rawEventLength** | 4 bytes | `uint32` (Big-Endian, unsigned 32-bit integer) | Exact byte length $N$ of `rawEventBytes` |
| **rawEventBytes** | $N$ bytes | Raw bytes (`utf-8` text or binary) | Original immutable event bytes as persisted by vault |

**Total Preimage Length:** $1 + 1 + 32 + 8 + 4 + N = 46 + N$ bytes.

### 3.3 Leaf Hash Computation

$$\text{leafHash} = \text{SHA-256}(\text{leafPreimage})$$

Output is exactly 32 bytes (256 bits).

---

## 4. Internal Node Rule

Given child node hashes `left` (32 bytes) and `right` (32 bytes), the parent node hash is computed as:

$$\text{node} = \text{SHA-256}(\mathtt{0x01} \parallel \text{left} \parallel \text{right})$$

- **Domain Tag:** `0x01` (1 byte).
- **Left Child Hash:** 32 bytes.
- **Right Child Hash:** 32 bytes.
- **Total Node Preimage Length:** $1 + 32 + 32 = 65$ bytes.
- **Output:** 32 bytes (SHA-256 digest).

---

## 5. Odd-Promotion Rule (Never Duplicated)

When constructing the binary Merkle tree over an ordered batch of leaves:

1. **Balanced Pairs:** Nodes at layer $k$ are processed left-to-right in pairs: $(N_0, N_1), (N_2, N_3), \dots$
2. **Odd Nodes Promoted Unchanged:** At any layer with an odd count of nodes $L_k$, the final unmatched node at index $L_k - 1$ is **promoted directly to the next layer unchanged**.
3. **No Duplication:** The odd node is **never duplicated** (unlike Bitcoin-style trees which duplicate $N_{L-1} \parallel N_{L-1}$). This eliminates CVE-2012-2459 second-preimage duplicate malleability vulnerabilities.
4. **Single-Leaf Batch ($N = 1$):** If a batch contains exactly 1 leaf, the Merkle root is the leaf hash itself ($L_0 = 1$, layer count = 1, $\text{root} = \text{leafHash}$).

---

## 6. Merkle Proof Format & Verification

### 6.1 Requirement for `(leafIndex, leafCount)`

> **CRITICAL REQUIREMENT:**  
> A proof **needs `(leafIndex, leafCount)`** so the verifier knows which levels have no sibling.

Because odd nodes are promoted unchanged without a sibling at levels where the layer length is odd, the tree structure is fully determined by the total number of leaves in the batch (`leafCount`) and the 0-based position of the leaf (`leafIndex`). With `(leafIndex, leafCount)`, the verifier can deterministically compute at each level whether a sibling exists, which side it is on, or whether the current node was promoted unchanged.

### 6.2 Deterministic Path Traversal Algorithm

Let:
- $L_0 = \text{leafCount}$ (number of nodes at layer 0)
- $i_0 = \text{leafIndex}$ (0-based index of current leaf at layer 0)
- $\text{current} = \text{leafHash}$
- $\text{siblingPointer} = 0$

At each layer $k \ge 0$, while $L_k > 1$:
1. **Check for Odd Promotion:**
   If $L_k$ is odd and $i_k == L_k - 1$:
   - The node was **promoted unchanged**.
   - **No sibling exists** at layer $k$.
   - $\text{current}$ remains unchanged ($\text{current} = \text{current}$).
   - $\text{siblingPointer}$ is **not** incremented.
2. **Check for Right Sibling:**
   If $i_k$ is even (and not promoted):
   - Sibling is on the **right** ($i_k + 1$).
   - $\text{sibling} = \text{proof.siblings}[\text{siblingPointer}++]$
   - $\text{current} = \text{SHA-256}(\mathtt{0x01} \parallel \text{current} \parallel \text{sibling})$
3. **Check for Left Sibling:**
   If $i_k$ is odd:
   - Sibling is on the **left** ($i_k - 1$).
   - $\text{sibling} = \text{proof.siblings}[\text{siblingPointer}++]$
   - $\text{current} = \text{SHA-256}(\mathtt{0x01} \parallel \text{sibling} \parallel \text{current})$
4. **Advance to Next Layer:**
   - $L_{k+1} = \lfloor (L_k + 1) / 2 \rfloor$
   - $i_{k+1} = \lfloor i_k / 2 \rfloor$

Upon reaching $L_k = 1$:
$$\text{isValid} \iff \text{current} == \text{expectedRoot}$$

### 6.3 JSON Proof Representation

```json
{
  "leafIndex": 2,
  "leafCount": 3,
  "leafHash": "0x73a8...",
  "root": "0xa2c7...",
  "siblings": [
    "0x5f91..."
  ]
}
```

---

## 7. Negative Verification Cases

1. **Modified Leaf (`modified_leaf`):** If any byte of `rawEventBytes`, `vaultSequence`, or `sourceId` is altered, `leafHash` differs, causing traversal to produce a root that mismatches `expectedRoot`.
2. **Wrong Leaf Count (`wrong_leaf_count`):** If `leafCount` is altered (e.g., claiming 4 leaves instead of 3), the verifier computes incorrect layer parities and expects a sibling where an odd node was promoted, causing proof verification to fail.

---

## 8. Test Vectors Reference

The frozen vectors covering batches with 1, 2, 3, 4, 5, and 7 leaves are generated and maintained in [vectors/merkle.json](file:///Users/sukruthasrigadde/stuff/NeuroNova/vectors/merkle.json).
