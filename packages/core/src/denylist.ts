// Addresses of keys that are committed to the public repo or are well-known defaults.
export const COMPROMISED_ADDRESSES: ReadonlySet<string> = new Set([
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Hardhat #0
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // Hardhat #1
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', // Hardhat #2
  '0xFCAd0B19bB29D4674531d6f115237E16AfCE377c', // lab mock vault key
  '0x6A9296CEb89D12e1F53b2Dd5Df45d3ADB3A814c2', // backend test relayer
  '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf', // trivial test key
  '0x00ec2241529f64253d1239Ce336a15f1f454e839', // committed Orchard dry-run vault key
  '0x36EB00D4BF389F3323d1C66b35a8827Dddbae504'  // old render.yaml vault signer
].map((address) => address.toLowerCase()));

export const LOCAL_TEST_CHAIN_IDS: ReadonlySet<bigint> = new Set<bigint>([31337n, 1337n]);

export function isCompromisedAddress(address: string): boolean {
  return COMPROMISED_ADDRESSES.has(address.toLowerCase());
}

export function assertAddressNotCompromised(address: string, chainId: bigint | number, label: string): void {
  if (LOCAL_TEST_CHAIN_IDS.has(BigInt(chainId))) return;
  if (isCompromisedAddress(address)) {
    throw new Error(`SECURITY: ${label} ${address} is a publicly known or committed test key and must not be used on chain ${chainId}`);
  }
}
