import { network } from "hardhat";

const { ethers } = await network.connect();
const eth = (v: bigint) => ethers.formatEther(v) + " ETH";
const STATUS = ["Requested", "Funded", "Active", "Repaid", "Defaulted", "Cancelled"];
const DAY = 24 * 60 * 60;

const [admin, borrower, g1, g2, lender] = await ethers.getSigners();

console.log("1. Deploying contracts...");
const group = await ethers.deployContract("Group");
const rep = await ethers.deployContract("Reputation");
const pool = await ethers.deployContract("LoanPool", [
  await group.getAddress(),
  await rep.getAddress(),
]);
await rep.setUpdater(await pool.getAddress(), true);
console.log("   Group:     ", await group.getAddress());
console.log("   Reputation:", await rep.getAddress());
console.log("   LoanPool:  ", await pool.getAddress());

console.log("2. Creating group and adding members...");
await group.connect(admin).createGroup("Mama Mboga SHG");
await group.addMember(1, borrower.address);
await group.addMember(1, g1.address);
await group.addMember(1, g2.address);
const [name, , count] = await group.getGroup(1);
console.log(`   "${name}" now has ${count} members`);

console.log("3. Borrower requests a 1 ETH loan (4 installments, 2 guarantors)...");
console.log("   Reputation before:", (await rep.getScore(borrower.address)).toString());
await pool.connect(borrower).requestLoan(1, ethers.parseEther("1"), 4, 30 * DAY, 2);

console.log("4. Two group members guarantee it (0.1 ETH stake each)...");
const stake = ethers.parseEther("0.1");
await pool.connect(g1).guarantee(1, { value: stake });
await pool.connect(g2).guarantee(1, { value: stake });

console.log("5. Lender funds the loan...");
await pool.connect(lender).fund(1, { value: ethers.parseEther("1") });
console.log("   Status:", STATUS[Number((await pool.getLoan(1)).status)]);

console.log("6. Borrower withdraws the loan...");
await pool.connect(borrower).withdrawLoan(1);
console.log("   Status:", STATUS[Number((await pool.getLoan(1)).status)]);

console.log("7. Borrower repays in 4 installments...");
const installment = ethers.parseEther("1.05") / 4n;
for (let i = 1; i <= 4; i++) {
  await pool.connect(borrower).repay(1, { value: installment });
  const loan = await pool.getLoan(1);
  console.log(`   Installment ${i}: repaid ${eth(loan.repaid)} of ${eth(loan.totalDue)}`);
}
console.log("   Status:", STATUS[Number((await pool.getLoan(1)).status)]);

console.log("8. Results...");
console.log("   Reputation after:", (await rep.getScore(borrower.address)).toString());
console.log("   Lender can withdraw:", eth(await pool.withdrawable(lender.address)));
console.log("   Guarantor stake refunded:", eth(await pool.withdrawable(g1.address)));
console.log("Done.");