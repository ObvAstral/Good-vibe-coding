import { defineConfig } from "hardhat/config";
import viemToolbox from "@nomicfoundation/hardhat-toolbox-viem";
export default defineConfig({
  plugins: [viemToolbox],
  solidity: {
    version: "0.8.28",
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  paths: { sources: "./src", tests: { nodejs: "./test" } },
  networks: {
    hardhatMainnet: { type: "edr-simulated", chainType: "l1", chainId: 31337 },
  },
});
