// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Group
/// @notice Self-help groups (SHGs): creation, membership and admin control.
/// Personal details stay off-chain; only addresses are stored here.
contract Group {
    struct SHG {
        string name;
        address admin;
        uint256 memberCount;
        bool exists;
    }

    uint256 public groupCount;
    mapping(uint256 => SHG) private groups;
    mapping(uint256 => mapping(address => bool)) private members;

    event GroupCreated(uint256 indexed groupId, string name, address indexed admin);
    event MemberJoined(uint256 indexed groupId, address indexed member);
    event MemberRemoved(uint256 indexed groupId, address indexed member);
    event AdminTransferred(uint256 indexed groupId, address indexed oldAdmin, address indexed newAdmin);

    error GroupNotFound();
    error NotGroupAdmin();
    error AlreadyMember();
    error NotMember();
    error EmptyName();
    error ZeroAddress();

    modifier groupExists(uint256 groupId) {
        if (!groups[groupId].exists) revert GroupNotFound();
        _;
    }

    modifier onlyAdmin(uint256 groupId) {
        if (groups[groupId].admin != msg.sender) revert NotGroupAdmin();
        _;
    }

    /// @notice Create a new group. The caller becomes its admin and first member.
    function createGroup(string calldata name) external returns (uint256 groupId) {
        if (bytes(name).length == 0) revert EmptyName();
        groupId = ++groupCount;
        groups[groupId] = SHG(name, msg.sender, 1, true);
        members[groupId][msg.sender] = true;
        emit GroupCreated(groupId, name, msg.sender);
        emit MemberJoined(groupId, msg.sender);
    }

    /// @notice Admin adds a member to the group.
    function addMember(uint256 groupId, address member)
        external
        groupExists(groupId)
        onlyAdmin(groupId)
    {
        if (member == address(0)) revert ZeroAddress();
        if (members[groupId][member]) revert AlreadyMember();
        members[groupId][member] = true;
        groups[groupId].memberCount++;
        emit MemberJoined(groupId, member);
    }

    /// @notice Admin removes a member. The admin cannot remove themselves.
    function removeMember(uint256 groupId, address member)
        external
        groupExists(groupId)
        onlyAdmin(groupId)
    {
        if (!members[groupId][member]) revert NotMember();
        if (member == groups[groupId].admin) revert NotGroupAdmin();
        members[groupId][member] = false;
        groups[groupId].memberCount--;
        emit MemberRemoved(groupId, member);
    }

    /// @notice Hand admin rights to another existing member.
    function transferAdmin(uint256 groupId, address newAdmin)
        external
        groupExists(groupId)
        onlyAdmin(groupId)
    {
        if (!members[groupId][newAdmin]) revert NotMember();
        address old = groups[groupId].admin;
        groups[groupId].admin = newAdmin;
        emit AdminTransferred(groupId, old, newAdmin);
    }

    function isMember(uint256 groupId, address account) external view returns (bool) {
        return members[groupId][account];
    }

    function getGroup(uint256 groupId)
        external
        view
        groupExists(groupId)
        returns (string memory name, address admin, uint256 memberCount)
    {
        SHG storage g = groups[groupId];
        return (g.name, g.admin, g.memberCount);
    }
}