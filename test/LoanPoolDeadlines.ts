import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.connect();

const ONE = ethers.parseEther("1");
const DAY = 24 * 60 * 60;

describe("LoanPool deadlines and late repayments", function () {
  async function deploy() {
    const [admin, borrower, g1, g2, lender] = await ethers.getSigners();
    const group = await ethers.deployContract("Group");
    const rep = await ethers.deployContract("Reputation");
    const pool = await ethers.deployContract("LoanPool", [
      await group.getAddress(),
      await rep.getAddress(),
    ]);
    await rep.setUpdater(await pool.getAddress(), true);
    await group.connect(admin).createGroup("Mama Mboga SHG");
    await group.addMember(1, borrower.address);
    await group.addMember(1, g1.address);
    await group.addMember(1, g2.address);
    return { rep, pool, borrower, g1, g2, lender };
  }

  async function guaranteedLoan() {
    const ctx = await deploy();
    const stake = ONE / 10n;
    await ctx.pool.connect(ctx.borrower).requestLoan(1, ONE, 4, 30 * DAY, 2);
    await ctx.pool.connect(ctx.g1).guarantee(1, { value: stake });
    await ctx.pool.connect(ctx.g2).guarantee(1, { value: stake });
    return { ...ctx, stake };
  }

  async function fundedLoan() {
    const ctx = await guaranteedLoan();
    await ctx.pool.connect(ctx.lender).fund(1, { value: ONE });
    return ctx;
  }

  async function activeLoan() {
    const ctx = await fundedLoan();
    await ctx.pool.connect(ctx.borrower).withdrawLoan(1);
    return ctx;
  }

  it("expires an unfunded loan after 30 days and refunds the guarantors", async function () {
    const { pool, g1, g2, stake } = await guaranteedLoan();
    await expect(pool.expireLoan(1)).to.be.revertedWithCustomError(pool, "NotExpired");
    await networkHelpers.time.increase(31 * DAY);
    await expect(pool.expireLoan(1)).to.emit(pool, "LoanExpired").withArgs(1n);
    expect((await pool.getLoan(1)).status).to.equal(5n); // Cancelled
    expect(await pool.withdrawable(g1.address)).to.equal(stake);
    expect(await pool.withdrawable(g2.address)).to.equal(stake);
  });

  it("blocks guaranteeing after the funding window closes", async function () {
    const { pool, borrower, g1 } = await deploy();
    await pool.connect(borrower).requestLoan(1, ONE, 4, 30 * DAY, 2);
    await networkHelpers.time.increase(31 * DAY);
    await expect(
      pool.connect(g1).guarantee(1, { value: ONE / 10n })
    ).to.be.revertedWithCustomError(pool, "WindowClosed");
  });

  it("expires a funded loan the borrower never collects and refunds everyone", async function () {
    const { pool, lender, g1, stake } = await fundedLoan();
    await expect(pool.expireLoan(1)).to.be.revertedWithCustomError(pool, "NotExpired");
    await networkHelpers.time.increase(8 * DAY);
    await pool.expireLoan(1);
    expect((await pool.getLoan(1)).status).to.equal(5n); // Cancelled
    expect(await pool.withdrawable(lender.address)).to.equal(ONE);
    expect(await pool.withdrawable(g1.address)).to.equal(stake);
  });

  it("stops the borrower collecting a funded loan after the withdrawal window", async function () {
    const { pool, borrower } = await fundedLoan();
    await networkHelpers.time.increase(8 * DAY);
    await expect(
      pool.connect(borrower).withdrawLoan(1)
    ).to.be.revertedWithCustomError(pool, "WindowClosed");
  });

  it("raises reputation when every installment is paid on its due date", async function () {
    const { pool, rep, borrower } = await activeLoan();
    const installment = ethers.parseEther("1.05") / 4n;
    await networkHelpers.time.increase(10 * DAY);
    for (let i = 0; i < 4; i++) {
      await pool.connect(borrower).repay(1, { value: installment });
      await networkHelpers.time.increase(30 * DAY);
    }
    expect((await pool.getLoan(1)).status).to.equal(3n); // Repaid
    expect((await pool.getLoan(1)).lateInstallments).to.equal(0n);
    expect(await rep.getScore(borrower.address)).to.equal(520n);
  });

  it("lowers reputation when installments are paid late, even if the loan is repaid", async function () {
    const { pool, rep, borrower } = await activeLoan();
    await networkHelpers.time.increase(125 * DAY); // past all due dates, inside the grace period
    await pool.connect(borrower).repay(1, { value: ethers.parseEther("1.05") });
    expect((await pool.getLoan(1)).status).to.equal(3n); // Repaid
    expect((await pool.getLoan(1)).lateInstallments).to.equal(4n);
    expect(await rep.getScore(borrower.address)).to.equal(490n);
  });

  it("rejects loans that are too small or have too many installments", async function () {
    const { pool, borrower } = await deploy();
    await expect(
      pool.connect(borrower).requestLoan(1, 100n, 4, 30 * DAY, 2)
    ).to.be.revertedWithCustomError(pool, "InvalidParameters");
    await expect(
      pool.connect(borrower).requestLoan(1, ONE, 121, 30 * DAY, 2)
    ).to.be.revertedWithCustomError(pool, "InvalidParameters");
  });
});