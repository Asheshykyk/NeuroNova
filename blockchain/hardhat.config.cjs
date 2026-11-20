require("@nomicfoundation/hardhat-toolbox");

const LOCAL_RPC_URL = process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545';
const AMOY_RPC_URL = process.env.AMOY_RPC_URL || 'https://rpc-amoy.polygon.technology';
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;

// Known Hardhat default test keys
const HARDHAT_DEFAULT_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
];

/**
 * Safety validator for public network accounts.
 * RULE: Never use Hardhat default keys on a public network!
 */
function getPublicNetworkAccounts(key) {
  if (!key) {
    return [];
  }
  const cleanKey = key.toLowerCase();
  for (const defaultKey of HARDHAT_DEFAULT_KEYS) {
    if (cleanKey === defaultKey.toLowerCase() || cleanKey === defaultKey.slice(2).toLowerCase()) {
      throw new Error(
        'SECURITY VIOLATION: Attempted to configure Hardhat default key for a public network! (RULE)'
      );
    }
  }
  return [key.startsWith('0x') ? key : `0x${key}`];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      evmVersion: 'cancun'
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: LOCAL_RPC_URL,
      chainId: 31337
    },
    amoy: {
      url: AMOY_RPC_URL,
      chainId: 80002,
      // RULE: Never use Hardhat default keys on a public network!
      accounts: getPublicNetworkAccounts(RELAYER_PRIVATE_KEY)
    }
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  }
};
