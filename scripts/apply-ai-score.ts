// Applies the off-chain scorecard results on-chain, as the Reputation owner (deployer).
// 1) npx hardhat node                                              (leave running)
// 2) npx hardhat run scripts/deploy-local.ts --network localhost
// 3) python ai/score_mobile_money.py --input ai/data/mobile_money_sample.json --output ai/output/scores.json
// 4) npx hardhat run scripts/apply-ai-score.ts --network localhost
import { network } from "hardhat";
import fs from "node:fs";

const { ethers } = await network.connect();

const contracts = JSON.parse(fs.readFileSync("frontend/src/contracts.json", "utf8"));
const results = JSON.parse(fs.readFileSync("ai/output/scores.json", "utf8"));
const rep = await ethers.getContractAt("Reputation", contracts.Reputation.address);
const signers = await ethers.getSigners();

for (const r of results.borrowers) {
  const borrower = signers[r.account_index].address;
  try {
    await (await rep.setDataHash(borrower, r.data_hash)).wait();
    await (await rep.setStartingScore(borrower, r.score)).wait();
    console.log(`${r.label}: starting score ${r.score} set for ${borrower}`);
  } catch (err: any) {
    // e.g. ScoreAlreadySet when the script is run twice for the same borrower
    console.log(`${r.label}: skipped (${err.shortMessage ?? err.message})`);
  }
}
console.log("Done. Starting scores are public: see the StartingScoreSet events.");
