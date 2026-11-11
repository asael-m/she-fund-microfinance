import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.connect();

const ONE = ethers.parseEther("1");
const DAY = 24 * 60 * 60;

describe("LoanPool", function () {
  async function deploy() {
    const [admin, borrower, g1, g2, lender, outsider] = await ethers.getSigners();
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
    return { group, rep, pool, admin, borrower, g1, g2, lender, outsider };
  }

  // Loan of 1 ETH, 4 installments, 30 days apart, 2 guarantors. Stake = 0.1 ETH each.
  async function guaranteedLoan() {
    const ctx = await deploy();
    const { pool, borrower, g1, g2 } = ctx;
    await pool.connect(borrower).requestLoan(1, ONE, 4, 30 * DAY, 2);
    const stake = ONE / 10n;
    await pool.connect(g1).guarantee(1, { value: stake });
    await pool.connect(g2).guarantee(1, { value: stake });
    return { ...ctx, stake };
  }

  async function activeLoan() {
    const ctx = await guaranteedLoan();
    await ctx.pool.connect(ctx.lender).fund(1, { value: ONE });
    await ctx.pool.connect(ctx.borrower).withdrawLoan(1);
    return ctx;
  }

  it("lets a group member request a loan", async function () {
    const { pool, borrower } = await deploy();
    await expect(pool.connect(borrower).requestLoan(1, ONE, 4, 30 * DAY, 2))
      .to.emit(pool, "LoanRequested")
      .withArgs(1n, borrower.address, 1n, ONE);
    const loan = await pool.getLoan(1);
    expect(loan.totalDue).to.equal(ethers.parseEther("1.05"));
  });

  it("rejects loan requests from non-members", async function () {
    const { pool, outsider } = await deploy();
    await expect(
      pool.connect(outsider).requestLoan(1, ONE, 4, 30 * DAY, 2)
    ).to.be.revertedWithCustomError(pool, "NotGroupMember");
  });

  it("rejects invalid parameters", async function () {
    const { pool, borrower } = await deploy();
    await expect(
      pool.connect(borrower).requestLoan(1, 0, 4, 30 * DAY, 2)
    ).to.be.revertedWithCustomError(pool, "InvalidParameters");
  });

  it("requires the exact stake and group membership to guarantee", async function () {
    const { pool, borrower, g1, outsider } = await deploy();
    await pool.connect(borrower).requestLoan(1, ONE, 4, 30 * DAY, 2);
    await expect(
      pool.connect(g1).guarantee(1, { value: 1n })
    ).to.be.revertedWithCustomError(pool, "WrongStakeAmount");
    await expect(
      pool.connect(outsider).guarantee(1, { value: ONE / 10n })
    ).to.be.revertedWithCustomError(pool, "NotGroupMember");
    await expect(
      pool.connect(borrower).guarantee(1, { value: ONE / 10n })
    ).to.be.revertedWithCustomError(pool, "BorrowerCannotGuarantee");
  });

  it("blocks funding until enough guarantors have joined", async function () {
    const { pool, borrower, lender } = await deploy();
    await pool.connect(borrower).requestLoan(1, ONE, 4, 30 * DAY, 2);
    await expect(
      pool.connect(lender).fund(1, { value: ONE })
    ).to.be.revertedWithCustomError(pool, "NeedsMoreGuarantors");
  });

  it("moves to Funded when fully funded and rejects overfunding", async function () {
    const { pool, lender } = await guaranteedLoan();
    await expect(
      pool.connect(lender).fund(1, { value: ONE + 1n })
    ).to.be.revertedWithCustomError(pool, "ExceedsRemaining");
    await expect(pool.connect(lender).fund(1, { value: ONE }))
      .to.emit(pool, "LoanFullyFunded")
      .withArgs(1n);
    expect((await pool.getLoan(1)).status).to.equal(1n); // Funded
  });

  it("pays the borrower on withdrawLoan and only the borrower can withdraw", async function () {
    const { pool, borrower, lender, g1 } = await guaranteedLoan();
    await pool.connect(lender).fund(1, { value: ONE });
    await expect(
      pool.connect(g1).withdrawLoan(1)
    ).to.be.revertedWithCustomError(pool, "NotBorrower");
    await expect(
      pool.connect(borrower).withdrawLoan(1)
    ).to.changeEtherBalance(ethers, borrower, ONE);
    expect((await pool.getLoan(1)).status).to.equal(2n); // Active
  });

  it("completes a full repayment, pays the lender, refunds stakes and raises reputation", async function () {
    const { pool, rep, borrower, lender, g1, g2, stake } = await activeLoan();
    const total = ethers.parseEther("1.05");
    await pool.connect(borrower).repay(1, { value: total });

    expect((await pool.getLoan(1)).status).to.equal(3n); // Repaid
    expect(await pool.withdrawable(lender.address)).to.equal(total);
    expect(await pool.withdrawable(g1.address)).to.equal(stake);
    expect(await pool.withdrawable(g2.address)).to.equal(stake);
    expect(await rep.getScore(borrower.address)).to.equal(520n);

    await expect(pool.connect(lender).withdraw()).to.changeEtherBalance(
      ethers,
      lender,
      total
    );
  });

  it("rejects repayments above the amount owed", async function () {
    const { pool, borrower } = await activeLoan();
    await expect(
      pool.connect(borrower).repay(1, { value: ethers.parseEther("1.06") })
    ).to.be.revertedWithCustomError(pool, "ExceedsRemaining");
  });

  it("cannot be marked default before the deadline", async function () {
    const { pool } = await activeLoan();
    await expect(pool.markDefault(1)).to.be.revertedWithCustomError(
      pool,
      "NotYetDefaultable"
    );
  });

  it("defaults after the deadline: slashes stakes to lenders and cuts reputation", async function () {
    const { pool, rep, borrower, lender, g1, stake } = await activeLoan();
    await networkHelpers.time.increase(4 * 30 * DAY + 8 * DAY);
    await expect(pool.markDefault(1)).to.emit(pool, "LoanDefaulted").withArgs(1n);

    expect((await pool.getLoan(1)).status).to.equal(4n); // Defaulted
    expect(await pool.withdrawable(lender.address)).to.equal(stake * 2n);
    expect(await pool.withdrawable(g1.address)).to.equal(0n);
    expect(await rep.getScore(borrower.address)).to.equal(400n);
  });

  it("lets the borrower cancel before funding and refunds guarantors", async function () {
    const { pool, borrower, g1, stake } = await guaranteedLoan();
    await pool.connect(borrower).cancelLoan(1);
    expect((await pool.getLoan(1)).status).to.equal(5n); // Cancelled
    expect(await pool.withdrawable(g1.address)).to.equal(stake);
  });
});