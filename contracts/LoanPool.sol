// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IGroup {
    function isMember(uint256 groupId, address account) external view returns (bool);
}

interface IReputation {
    function getScore(address borrower) external view returns (uint256);
    function recordRepayment(address borrower, bool onTime) external;
    function recordDefault(address borrower) external;
}

/// @title LoanPool
/// @notice Group-guaranteed microloans funded by lenders, with reputation updates.
contract LoanPool {
    enum Status { Requested, Funded, Active, Repaid, Defaulted, Cancelled }

    struct Loan {
        address borrower;
        uint256 groupId;
        uint256 principal;
        uint256 totalDue;         // principal + interest
        uint256 installments;
        uint256 installmentsPaid;
        uint256 intervalSeconds;
        uint256 guarantorsNeeded;
        uint256 guarantorStake;   // per guarantor
        uint256 funded;
        uint256 repaid;
        uint256 startTime;
        Status status;
    }

    uint256 public constant INTEREST_BPS = 500;       // 5% flat
    uint256 public constant STAKE_BPS = 1000;         // 10% of principal per guarantor
    uint256 public constant MIN_REPUTATION = 300;
    uint256 public constant GRACE_PERIOD = 7 days;

    IGroup public immutable groupContract;
    IReputation public immutable reputation;

    uint256 public loanCount;
    mapping(uint256 => Loan) private loans;
    mapping(uint256 => address[]) private guarantors;
    mapping(uint256 => mapping(address => bool)) private isGuarantor;
    mapping(uint256 => address[]) private lenders;
    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(address => uint256) public withdrawable;  // lender earnings and refunds

    event LoanRequested(uint256 indexed loanId, address indexed borrower, uint256 indexed groupId, uint256 principal);
    event LoanGuaranteed(uint256 indexed loanId, address indexed guarantor, uint256 stake);
    event LoanFunded(uint256 indexed loanId, address indexed lender, uint256 amount);
    event LoanFullyFunded(uint256 indexed loanId);
    event LoanDisbursed(uint256 indexed loanId, address indexed borrower, uint256 amount);
    event RepaymentMade(uint256 indexed loanId, uint256 amount, uint256 installmentsPaid, bool onTime);
    event LoanRepaid(uint256 indexed loanId);
    event LoanDefaulted(uint256 indexed loanId);
    event LoanCancelled(uint256 indexed loanId);
    event Withdrawn(address indexed account, uint256 amount);

    error NotGroupMember();
    error ReputationTooLow();
    error InvalidParameters();
    error LoanNotFound();
    error WrongStatus();
    error NotBorrower();
    error BorrowerCannotGuarantee();
    error AlreadyGuarantor();
    error GuarantorsComplete();
    error WrongStakeAmount();
    error NeedsMoreGuarantors();
    error ZeroAmount();
    error ExceedsRemaining();
    error NotYetDefaultable();
    error NothingToWithdraw();
    error TransferFailed();

    constructor(address groupAddress, address reputationAddress) {
        groupContract = IGroup(groupAddress);
        reputation = IReputation(reputationAddress);
    }

    modifier loanExists(uint256 loanId) {
        if (loanId == 0 || loanId > loanCount) revert LoanNotFound();
        _;
    }

    // ---------------------------------------------------------------- request

    function requestLoan(
        uint256 groupId,
        uint256 principal,
        uint256 installments,
        uint256 intervalSeconds,
        uint256 guarantorsNeeded
    ) external returns (uint256 loanId) {
        if (!groupContract.isMember(groupId, msg.sender)) revert NotGroupMember();
        if (reputation.getScore(msg.sender) < MIN_REPUTATION) revert ReputationTooLow();
        if (principal == 0 || installments == 0 || intervalSeconds == 0 || guarantorsNeeded == 0) {
            revert InvalidParameters();
        }

        loanId = ++loanCount;
        Loan storage l = loans[loanId];
        l.borrower = msg.sender;
        l.groupId = groupId;
        l.principal = principal;
        l.totalDue = principal + (principal * INTEREST_BPS) / 10000;
        l.installments = installments;
        l.intervalSeconds = intervalSeconds;
        l.guarantorsNeeded = guarantorsNeeded;
        l.guarantorStake = (principal * STAKE_BPS) / 10000;
        l.status = Status.Requested;

        emit LoanRequested(loanId, msg.sender, groupId, principal);
    }

    /// @notice Borrower can cancel before funding completes. Stakes and funds are refunded.
    function cancelLoan(uint256 loanId) external loanExists(loanId) {
        Loan storage l = loans[loanId];
        if (msg.sender != l.borrower) revert NotBorrower();
        if (l.status != Status.Requested) revert WrongStatus();
        l.status = Status.Cancelled;

        address[] storage gs = guarantors[loanId];
        for (uint256 i = 0; i < gs.length; i++) {
            withdrawable[gs[i]] += l.guarantorStake;
        }
        address[] storage ls = lenders[loanId];
        for (uint256 i = 0; i < ls.length; i++) {
            withdrawable[ls[i]] += contributions[loanId][ls[i]];
        }
        emit LoanCancelled(loanId);
    }

    // -------------------------------------------------------------- guarantee

    function guarantee(uint256 loanId) external payable loanExists(loanId) {
        Loan storage l = loans[loanId];
        if (l.status != Status.Requested) revert WrongStatus();
        if (msg.sender == l.borrower) revert BorrowerCannotGuarantee();
        if (!groupContract.isMember(l.groupId, msg.sender)) revert NotGroupMember();
        if (isGuarantor[loanId][msg.sender]) revert AlreadyGuarantor();
        if (guarantors[loanId].length >= l.guarantorsNeeded) revert GuarantorsComplete();
        if (msg.value != l.guarantorStake) revert WrongStakeAmount();

        isGuarantor[loanId][msg.sender] = true;
        guarantors[loanId].push(msg.sender);
        emit LoanGuaranteed(loanId, msg.sender, msg.value);
    }

    // ---------------------------------------------------------------- funding

    function fund(uint256 loanId) external payable loanExists(loanId) {
        Loan storage l = loans[loanId];
        if (l.status != Status.Requested) revert WrongStatus();
        if (guarantors[loanId].length < l.guarantorsNeeded) revert NeedsMoreGuarantors();
        if (msg.value == 0) revert ZeroAmount();
        if (l.funded + msg.value > l.principal) revert ExceedsRemaining();

        if (contributions[loanId][msg.sender] == 0) lenders[loanId].push(msg.sender);
        contributions[loanId][msg.sender] += msg.value;
        l.funded += msg.value;
        emit LoanFunded(loanId, msg.sender, msg.value);

        if (l.funded == l.principal) {
            l.status = Status.Funded;
            emit LoanFullyFunded(loanId);
        }
    }

    /// @notice Borrower collects the funds. This starts the repayment clock.
    function withdrawLoan(uint256 loanId) external loanExists(loanId) {
        Loan storage l = loans[loanId];
        if (msg.sender != l.borrower) revert NotBorrower();
        if (l.status != Status.Funded) revert WrongStatus();
        l.status = Status.Active;
        l.startTime = block.timestamp;
        (bool ok, ) = payable(msg.sender).call{value: l.principal}("");
        if (!ok) revert TransferFailed();
        emit LoanDisbursed(loanId, msg.sender, l.principal);
    }

    // -------------------------------------------------------------- repayment

    /// @notice Pay one or more installments. Send any amount up to what is still owed.
    function repay(uint256 loanId) external payable loanExists(loanId) {
        Loan storage l = loans[loanId];
        if (l.status != Status.Active) revert WrongStatus();
        if (msg.value == 0) revert ZeroAmount();
        if (l.repaid + msg.value > l.totalDue) revert ExceedsRemaining();

        l.repaid += msg.value;

        // Credit lenders pro rata
        address[] storage ls = lenders[loanId];
        uint256 distributed = 0;
        for (uint256 i = 0; i < ls.length; i++) {
            uint256 share = (msg.value * contributions[loanId][ls[i]]) / l.principal;
            withdrawable[ls[i]] += share;
            distributed += share;
        }
        // Rounding dust goes to the first lender
        if (distributed < msg.value && ls.length > 0) {
            withdrawable[ls[0]] += msg.value - distributed;
        }

        // How many installments does the total repaid cover?
        uint256 perInstallment = l.totalDue / l.installments;
        uint256 covered = l.repaid >= l.totalDue ? l.installments : l.repaid / perInstallment;
        l.installmentsPaid = covered;

        // On time if repaid enough by the end of the most recent due period
        bool onTime = block.timestamp <= l.startTime + (_installmentsDue(l) * l.intervalSeconds);
        if (_installmentsDue(l) <= covered) onTime = true;
        emit RepaymentMade(loanId, msg.value, covered, onTime);

        if (l.repaid == l.totalDue) {
            l.status = Status.Repaid;
            // Refund guarantor stakes
            address[] storage gs = guarantors[loanId];
            for (uint256 i = 0; i < gs.length; i++) {
                withdrawable[gs[i]] += l.guarantorStake;
            }
            reputation.recordRepayment(l.borrower, _wasOnTimeOverall(l));
            emit LoanRepaid(loanId);
        }
    }

    // ---------------------------------------------------------------- default

    /// @notice Anyone can flag a loan as defaulted once the deadline plus grace period passes.
    function markDefault(uint256 loanId) external loanExists(loanId) {
        Loan storage l = loans[loanId];
        if (l.status != Status.Active) revert WrongStatus();
        uint256 deadline = l.startTime + (l.installments * l.intervalSeconds) + GRACE_PERIOD;
        if (block.timestamp <= deadline) revert NotYetDefaultable();

        l.status = Status.Defaulted;

        // Slash guarantor stakes and pay them to lenders pro rata
        address[] storage gs = guarantors[loanId];
        uint256 slashed = gs.length * l.guarantorStake;
        address[] storage ls = lenders[loanId];
        uint256 distributed = 0;
        for (uint256 i = 0; i < ls.length; i++) {
            uint256 share = (slashed * contributions[loanId][ls[i]]) / l.principal;
            withdrawable[ls[i]] += share;
            distributed += share;
        }
        if (distributed < slashed && ls.length > 0) {
            withdrawable[ls[0]] += slashed - distributed;
        }

        reputation.recordDefault(l.borrower);
        emit LoanDefaulted(loanId);
    }

    // ------------------------------------------------------------- withdrawals

    /// @notice Lenders and guarantors collect their earnings and refunds.
    function withdraw() external {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------ views

    function getLoan(uint256 loanId) external view loanExists(loanId) returns (Loan memory) {
        return loans[loanId];
    }

    function getGuarantors(uint256 loanId) external view returns (address[] memory) {
        return guarantors[loanId];
    }

    function getLenders(uint256 loanId) external view returns (address[] memory) {
        return lenders[loanId];
    }

    // --------------------------------------------------------------- internals

    /// @dev How many installments should be paid by now (capped at the total).
    function _installmentsDue(Loan storage l) private view returns (uint256) {
        if (l.startTime == 0) return 0;
        uint256 elapsed = block.timestamp - l.startTime;
        uint256 due = (elapsed + l.intervalSeconds - 1) / l.intervalSeconds; // round up
        if (due == 0) due = 1;
        return due > l.installments ? l.installments : due;
    }

    /// @dev Final repayment counts as on time if it lands before the last deadline.
    function _wasOnTimeOverall(Loan storage l) private view returns (bool) {
        return block.timestamp <= l.startTime + (l.installments * l.intervalSeconds);
    }
}