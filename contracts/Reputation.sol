// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Reputation
/// @notice Stores a credit-style reputation score per borrower (0-1000).
/// Only authorized contracts (e.g. LoanPool) can change scores after repayments.
/// Off-chain "alternative data" is represented by a hash only, for privacy.
/// The owner may set ONE limited starting score from that data (a trusted oracle).
contract Reputation {
    uint256 public constant INITIAL_SCORE = 500;
    uint256 public constant MAX_SCORE = 1000;
    uint256 public constant ON_TIME_BONUS = 20;
    uint256 public constant LATE_PENALTY = 10;
    uint256 public constant DEFAULT_PENALTY = 100;

    // Alternative-data starting score limits: repayments must still matter most,
    // and the floor equals LoanPool.MIN_REPUTATION so nobody is locked out by the model.
    uint256 public constant MIN_STARTING_SCORE = 300;
    uint256 public constant MAX_STARTING_SCORE = 700;

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
    event StartingScoreSet(address indexed borrower, uint256 score, bytes32 dataHash);

    error NotOwner();
    error NotUpdater();
    error NoDataHash();
    error ScoreOutOfRange();
    error ScoreAlreadySet();

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

    /// @notice Set a borrower's starting score from off-chain alternative data.
    /// Rules: owner only; a data hash must already be stored for the borrower;
    /// the score must be within 300-700; and it works only for borrowers with no
    /// score history, so an earned score (or an earlier starting score) is never overwritten.
    /// The event records the score and the data hash so anyone can audit the decision.
    function setStartingScore(address borrower, uint256 score) external onlyOwner {
        if (hasScore[borrower]) revert ScoreAlreadySet();
        bytes32 h = dataHash[borrower];
        if (h == bytes32(0)) revert NoDataHash();
        if (score < MIN_STARTING_SCORE || score > MAX_STARTING_SCORE) revert ScoreOutOfRange();
        _set(borrower, score, "alternative-data starting score");
        emit StartingScoreSet(borrower, score, h);
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
