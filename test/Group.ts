import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("Group", function () {
  async function deploy() {
    const [admin, alice, bob, outsider] = await ethers.getSigners();
    const group = await ethers.deployContract("Group");
    await group.connect(admin).createGroup("Mama Mboga SHG");
    return { group, admin, alice, bob, outsider };
  }

  it("creates a group with the creator as admin and first member", async function () {
    const { group, admin } = await deploy();
    const [name, groupAdmin, count] = await group.getGroup(1);
    expect(name).to.equal("Mama Mboga SHG");
    expect(groupAdmin).to.equal(admin.address);
    expect(count).to.equal(1n);
    expect(await group.isMember(1, admin.address)).to.equal(true);
  });

  it("rejects empty group names", async function () {
    const { group } = await deploy();
    await expect(group.createGroup("")).to.be.revertedWithCustomError(group, "EmptyName");
  });

  it("lets the admin add members and emits an event", async function () {
    const { group, alice } = await deploy();
    await expect(group.addMember(1, alice.address))
      .to.emit(group, "MemberJoined")
      .withArgs(1n, alice.address);
    expect(await group.isMember(1, alice.address)).to.equal(true);
    const [, , count] = await group.getGroup(1);
    expect(count).to.equal(2n);
  });

  it("blocks non-admins from adding members", async function () {
    const { group, outsider, bob } = await deploy();
    await expect(
      group.connect(outsider).addMember(1, bob.address)
    ).to.be.revertedWithCustomError(group, "NotGroupAdmin");
  });

  it("rejects duplicate members", async function () {
    const { group, alice } = await deploy();
    await group.addMember(1, alice.address);
    await expect(group.addMember(1, alice.address)).to.be.revertedWithCustomError(
      group,
      "AlreadyMember"
    );
  });

  it("lets the admin remove a member but not themselves", async function () {
    const { group, admin, alice } = await deploy();
    await group.addMember(1, alice.address);
    await group.removeMember(1, alice.address);
    expect(await group.isMember(1, alice.address)).to.equal(false);
    await expect(group.removeMember(1, admin.address)).to.be.revertedWithCustomError(
      group,
      "NotGroupAdmin"
    );
  });

  it("transfers admin rights to an existing member only", async function () {
    const { group, alice, outsider } = await deploy();
    await expect(group.transferAdmin(1, outsider.address)).to.be.revertedWithCustomError(
      group,
      "NotMember"
    );
    await group.addMember(1, alice.address);
    await group.transferAdmin(1, alice.address);
    const [, newAdmin] = await group.getGroup(1);
    expect(newAdmin).to.equal(alice.address);
  });

  it("reverts for groups that do not exist", async function () {
    const { group } = await deploy();
    await expect(group.getGroup(99)).to.be.revertedWithCustomError(group, "GroupNotFound");
  });
});