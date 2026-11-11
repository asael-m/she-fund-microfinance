import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("Reputation", function () {
  async function deploy() {
    const [owner, pool, borrower, other] = await ethers.getSigners();
    const rep = await ethers.deployContract("Reputation");
    await rep.setUpdater(pool.address, true);
    return { rep, owner, pool, borrower, other };
  }

  it("gives new borrowers the initial score of 500", async function () {
    const { rep, borrower } = await deploy();
    expect(await rep.getScore(borrower.address)).to.equal(500n);
  });

  it("raises the score on an on-time repayment and emits an event", async function () {
    const { rep, pool, borrower } = await deploy();
    await expect(rep.connect(pool).recordRepayment(borrower.address, true))
      .to.emit(rep, "ScoreUpdated")
      .withArgs(borrower.address, 500n, 520n, "on-time repayment");
    expect(await rep.getScore(borrower.address)).to.equal(520n);
  });

  it("lowers the score on a late repayment and on default", async function () {
    const { rep, pool, borrower } = await deploy();
    await rep.connect(pool).recordRepayment(borrower.address, false);
    expect(await rep.getScore(borrower.address)).to.equal(490n);
    await rep.connect(pool).recordDefault(borrower.address);
    expect(await rep.getScore(borrower.address)).to.equal(390n);
  });

  it("never goes above 1000 or below 0", async function () {
    const { rep, pool, borrower } = await deploy();
    for (let i = 0; i < 30; i++) {
      await rep.connect(pool).recordRepayment(borrower.address, true);
    }
    expect(await rep.getScore(borrower.address)).to.equal(1000n);
    for (let i = 0; i < 12; i++) {
      await rep.connect(pool).recordDefault(borrower.address);
    }
    expect(await rep.getScore(borrower.address)).to.equal(0n);
  });

  it("blocks unauthorized addresses from changing scores", async function () {
    const { rep, other, borrower } = await deploy();
    await expect(
      rep.connect(other).recordRepayment(borrower.address, true)
    ).to.be.revertedWithCustomError(rep, "NotUpdater");
  });

  it("only lets the owner authorize updaters and store data hashes", async function () {
    const { rep, other, borrower } = await deploy();
    await expect(
      rep.connect(other).setUpdater(other.address, true)
    ).to.be.revertedWithCustomError(rep, "NotOwner");
    const hash = ethers.keccak256(ethers.toUtf8Bytes("mobile-money-summary"));
    await rep.setDataHash(borrower.address, hash);
    expect(await rep.dataHash(borrower.address)).to.equal(hash);
  });
});