// Deploys SHE-Fund to Celo Sepolia and records the addresses for the report.
// Run: npx hardhat run scripts/deploy-celo.ts --network celoSepolia
// Writes docs/celo-deployment.json (addresses and links only, no keys).
import { network } from "hardhat";
import fs from "node:fs";

const EXPLORER = "https://celo-sepolia.blockscout.com";
const CELO_SEPOLIA_CHAIN_ID = 11142220n;

const { ethers } = await network.connect();

const net = await ethers.provider.getNetwork();
if (net.chainId !== CELO_SEPOLIA_CHAIN_ID) {
  throw new Error(
    `Wrong network (chain ID ${net.chainId}). Run with --network celoSepolia.`
  );
}

const [deployer] = await ethers.getSigners();
const balance = await ethers.provider.getBalance(deployer.address);
console.log("Network:  Celo Sepolia (chain ID " + net.chainId + ")");
console.log("Deployer:", deployer.address);
console.log("Balance: ", ethers.formatEther(balance), "CELO");
if (balance === 0n) throw new Error("Deployer has no test CELO. Use the faucet first.");

const record: Record<string, any> = {};

async function deploy(name: string, args: any[] = []) {
  console.log(`Deploying ${name}...`);
  const c = await ethers.deployContract(name, args);
  await c.waitForDeployment();
  const address = await c.getAddress();
  const txHash = c.deploymentTransaction()!.hash;
  record[name] = {
    address,
    deploymentTx: txHash,
    addressLink: `${EXPLORER}/address/${address}`,
    txLink: `${EXPLORER}/tx/${txHash}`,
  };
  console.log(`  ${name}: ${address}`);
  return c;
}

const group = await deploy("Group");
const rep = await deploy("Reputation");
const pool = await deploy("LoanPool", [
  await group.getAddress(),
  await rep.getAddress(),
]);

console.log("Authorizing LoanPool to update reputation scores...");
const tx = await rep.setUpdater(await pool.getAddress(), true);
await tx.wait();
record.setUpdaterTx = tx.hash;
record.setUpdaterTxLink = `${EXPLORER}/tx/${tx.hash}`;

const out = {
  network: "Celo Sepolia",
  chainId: Number(net.chainId),
  deployer: deployer.address,
  deployedAt: new Date().toISOString(),
  contracts: {
    Group: record.Group,
    Reputation: record.Reputation,
    LoanPool: record.LoanPool,
  },
  setUpdater: { tx: record.setUpdaterTx, link: record.setUpdaterTxLink },
};

fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/celo-deployment.json", JSON.stringify(out, null, 2));
console.log("\nDone. Saved docs/celo-deployment.json");
console.log("Open these in your browser and screenshot them:");
for (const n of ["Group", "Reputation", "LoanPool"]) {
  console.log(`  ${n}: ${record[n].addressLink}`);
}
