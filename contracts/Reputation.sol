// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Reputation
/// @notice Stores a credit-style reputation score per borrower (0-1000).
/// Only authorized contracts (e.g. LoanPool) can change scores.
/// Off-chain "alternative data" is represented by a hash only, for privacy.
contract Reputation {
    uint256 public constant INITIAL_SCORE = 500;
    uint256 public constant MAX_SCORE = 1000;
    uint256 public constant ON_TIME_BONUS = 20;
    uint256 public constant LATE_PENALTY = 10;
    uint256 public constant DEFAULT_PENALTY = 100;

    address public owner;
    mapping(address => bool) public isUpdater;
    mapping(address => uint256) private scores;
    mapping(address => bool) private hasScore;
    mapping(address => bytes32) public dataHash;

    event UpdaterSet(address indexed updater, bool allowed);
    event DataHashSet(address indexed borrower, bytes32 hash);
    event ScoreUpdated(
        address indexed borrower,
        uint256 oldScore,
        uint256 newScore,
        string reason
    );

    error NotOwner();
    error NotUpdater();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyUpdater() {
        if (!isUpdater[msg.sender]) revert NotUpdater();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Authorize or remove a contract/address that may change scores.
    function setUpdater(address updater, bool allowed) external onlyOwner {
        isUpdater[updater] = allowed;
        emit UpdaterSet(updater, allowed);
    }

    /// @notice Store the hash of off-chain data (simulated mobile-money history).
    function setDataHash(address borrower, bytes32 hash) external onlyOwner {
        dataHash[borrower] = hash;
        emit DataHashSet(borrower, hash);
    }

    /// @notice Returns the borrower's score (500 if they have no history yet).
    function getScore(address borrower) public view returns (uint256) {
        return hasScore[borrower] ? scores[borrower] : INITIAL_SCORE;
    }

    function recordRepayment(address borrower, bool onTime) external onlyUpdater {
        uint256 current = getScore(borrower);
        if (onTime) {
            _set(borrower, _add(current, ON_TIME_BONUS), "on-time repayment");
        } else {
            _set(borrower, _sub(current, LATE_PENALTY), "late repayment");
        }
    }

    function recordDefault(address borrower) external onlyUpdater {
        uint256 current = getScore(borrower);
        _set(borrower, _sub(current, DEFAULT_PENALTY), "loan default");
    }

    function _set(address borrower, uint256 newScore, string memory reason) private {
        uint256 oldScore = getScore(borrower);
        hasScore[borrower] = true;
        scores[borrower] = newScore;
        emit ScoreUpdated(borrower, oldScore, newScore, reason);
    }

    function _add(uint256 a, uint256 b) private pure returns (uint256) {
        uint256 c = a + b;
        return c > MAX_SCORE ? MAX_SCORE : c;
    }

    function _sub(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a - b : 0;
    }
}