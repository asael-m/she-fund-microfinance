import { network } from "hardhat";
import fs from "node:fs";

const { ethers } = await network.connect();

const group = await ethers.deployContract("Group");
const rep = await ethers.deployContract("Reputation");
const pool = await ethers.deployContract("LoanPool", [
  await group.getAddress(),
  await rep.getAddress(),
]);
await rep.setUpdater(await pool.getAddress(), true);

const abi = (name: string) =>
  JSON.parse(fs.readFileSync(`artifacts/contracts/${name}.sol/${name}.json`, "utf8")).abi;

fs.mkdirSync("frontend/src", { recursive: true });
fs.writeFileSync(
  "frontend/src/contracts.json",
  JSON.stringify(
    {
      Group: { address: await group.getAddress(), abi: abi("Group") },
      Reputation: { address: await rep.getAddress(), abi: abi("Reputation") },
      LoanPool: { address: await pool.getAddress(), abi: abi("LoanPool") },
    },
    null,
    2
  )
);
console.log("Deployed. Addresses and ABIs written to frontend/src/contracts.json");