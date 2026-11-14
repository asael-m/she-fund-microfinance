import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("Reputation starting score (alternative data)", () => {
  async function setup() {
    const [owner, borrower, other, updater, stranger] = await ethers.getSigners();
    const rep = await ethers.deployContract("Reputation");
    const hash = ethers.id("simulated mobile-money data, scorecard-v1");
    return { rep, owner, borrower, other, updater, stranger, hash };
  }

  it("lets the owner set a starting score and emits the score and data hash", async () => {
    const { rep, borrower, hash } = await setup();
    await rep.setDataHash(borrower.address, hash);
    await expect(rep.setStartingScore(borrower.address, 650))
      .to.emit(rep, "StartingScoreSet")
      .withArgs(borrower.address, 650, hash);
    expect(await rep.getScore(borrower.address)).to.equal(650n);
  });

  it("also records the change in the normal ScoreUpdated event", async () => {
    const { rep, borrower, hash } = await setup();
    await rep.setDataHash(borrower.address, hash);
    await expect(rep.setStartingScore(borrower.address, 650))
      .to.emit(rep, "ScoreUpdated")
      .withArgs(borrower.address, 500, 650, "alternative-data starting score");
  });

  it("only works for the owner", async () => {
    const { rep, borrower, stranger, hash } = await setup();
    await rep.setDataHash(borrower.address, hash);
    await expect(
      rep.connect(stranger).setStartingScore(borrower.address, 650)
    ).to.be.revertedWithCustomError(rep, "NotOwner");
  });

  it("requires a data hash to be stored first", async () => {
    const { rep, borrower } = await setup();
    await expect(
      rep.setStartingScore(borrower.address, 650)
    ).to.be.revertedWithCustomError(rep, "NoDataHash");
  });

  it("rejects scores outside 300-700 and accepts both limits", async () => {
    const { rep, borrower, other, hash } = await setup();
    await rep.setDataHash(borrower.address, hash);
    await rep.setDataHash(other.address, hash);
    await expect(
      rep.setStartingScore(borrower.address, 299)
    ).to.be.revertedWithCustomError(rep, "ScoreOutOfRange");
    await expect(
      rep.setStartingScore(borrower.address, 701)
    ).to.be.revertedWithCustomError(rep, "ScoreOutOfRange");
    await rep.setStartingScore(borrower.address, 300);
    await rep.setStartingScore(other.address, 700);
    expect(await rep.getScore(borrower.address)).to.equal(300n);
    expect(await rep.getScore(other.address)).to.equal(700n);
  });

  it("cannot overwrite a starting score that was already set", async () => {
    const { rep, borrower, hash } = await setup();
    await rep.setDataHash(borrower.address, hash);
    await rep.setStartingScore(borrower.address, 600);
    await expect(
      rep.setStartingScore(borrower.address, 400)
    ).to.be.revertedWithCustomError(rep, "ScoreAlreadySet");
    expect(await rep.getScore(borrower.address)).to.equal(600n);
  });

  it("cannot overwrite a score earned through repayment history", async () => {
    const { rep, borrower, updater, hash } = await setup();
    await rep.setUpdater(updater.address, true);
    await rep.connect(updater).recordRepayment(borrower.address, true); // 500 -> 520
    await rep.setDataHash(borrower.address, hash);
    await expect(
      rep.setStartingScore(borrower.address, 700)
    ).to.be.revertedWithCustomError(rep, "ScoreAlreadySet");
    expect(await rep.getScore(borrower.address)).to.equal(520n);
  });

  it("lets repayments and defaults move the score from the starting score", async () => {
    const { rep, borrower, updater, hash } = await setup();
    await rep.setUpdater(updater.address, true);
    await rep.setDataHash(borrower.address, hash);
    await rep.setStartingScore(borrower.address, 640);
    await rep.connect(updater).recordRepayment(borrower.address, true); // +20
    expect(await rep.getScore(borrower.address)).to.equal(660n);
    await rep.connect(updater).recordDefault(borrower.address); // -100
    expect(await rep.getScore(borrower.address)).to.equal(560n);
  });
});
