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
        uint256 requestedAt;
        uint256 fundedAt;
        uint256 lateInstallments;
    }

    uint256 public constant INTEREST_BPS = 500;        // 5% flat
    uint256 public constant STAKE_BPS = 1000;          // 10% of principal per guarantor
    uint256 public constant MIN_REPUTATION = 300;
    uint256 public constant MIN_PRINCIPAL = 1e12;      // keeps stakes and installments above zero
    uint256 public constant MAX_INSTALLMENTS = 120;
    uint256 public constant GRACE_PERIOD = 7 days;     // after the final deadline, before default
    uint256 public constant FUNDING_WINDOW = 30 days;  // to gather guarantors and funding
    uint256 public constant WITHDRAW_WINDOW = 7 days;  // for the borrower to collect a funded loan

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
    event LoanExpired(uint256 indexed loanId);
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
    error NotExpired();
    error WindowClosed();
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
        if (
            principal < MIN_PRINCIPAL ||
            installments == 0 ||
            installments > MAX_INSTALLMENTS ||
            intervalSeconds == 0 ||
            guarantorsNeeded == 0
        ) {
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
        l.requestedAt = block.timestamp;

        emit LoanRequested(loanId, msg.sender, groupId, principal);
    }

    /// @notice Borrower can cancel before funding completes. Stakes and funds are refunded.
    function cancelLoan(uint256 loanId) external loanExists(loanId) {
        Loan storage l = loans[loanId];
        if (msg.sender != l.borrower) revert NotBorrower();
        if (l.status != Status.Requested) revert WrongStatus();
        l.status = Status.Cancelled;
        _refundAll(loanId, l.guarantorStake);
        emit LoanCancelled(loanId);
    }

    /// @notice Anyone can close a stalled loan: not fully funded within the funding window,
    /// or funded but not collected by the borrower within the withdrawal window.
    /// Everyone gets their stake or funds back.
    function expireLoan(uint256 loanId) external loanExists(loanId) {
        Loan storage l = loans[loanId];
        if (l.status == Status.Requested) {
            if (block.timestamp <= l.requestedAt + FUNDING_WINDOW) revert NotExpired();
        } else if (l.status == Status.Funded) {
            if (block.timestamp <= l.fundedAt + WITHDRAW_WINDOW) revert NotExpired();
        } else {
            revert WrongStatus();
        }
        l.status = Status.Cancelled;
        _refundAll(loanId, l.guarantorStake);
        emit LoanExpired(loanId);
    }

    // -------------------------------------------------------------- guarantee

    function guarantee(uint256 loanId) external payable loanExists(loanId) {
        Loan storage l = loans[loanId];
        if (l.status != Status.Requested) revert WrongStatus();
        if (block.timestamp > l.requestedAt + FUNDING_WINDOW) revert WindowClosed();
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
        if (block.timestamp > l.requestedAt + FUNDING_WINDOW) revert WindowClosed();
        if (guarantors[loanId].length < l.guarantorsNeeded) revert NeedsMoreGuarantors();
        if (msg.value == 0) revert ZeroAmount();
        if (l.funded + msg.value > l.principal) revert ExceedsRemaining();

        if (contributions[loanId][msg.sender] == 0) lenders[loanId].push(msg.sender);
        contributions[loanId][msg.sender] += msg.value;
        l.funded += msg.value;
        emit LoanFunded(loanId, msg.sender, msg.value);

        if (l.funded == l.principal) {
            l.status = Status.Funded;
            l.fundedAt = block.timestamp;
            emit LoanFullyFunded(loanId);
        }
    }

    /// @notice Borrower collects the funds. This starts the repayment clock.
    function withdrawLoan(uint256 loanId) external loanExists(loanId) {
        Loan storage l = loans[loanId];
        if (msg.sender != l.borrower) revert NotBorrower();
        if (l.status != Status.Funded) revert WrongStatus();
        if (block.timestamp > l.fundedAt + WITHDRAW_WINDOW) revert WindowClosed();
        l.status = Status.Active;
        l.startTime = block.timestamp;
        (bool ok, ) = payable(msg.sender).call{value: l.principal}("");
        if (!ok) revert TransferFailed();
        emit LoanDisbursed(loanId, msg.sender, l.principal);
    }

    // -------------------------------------------------------------- repayment

    /// @notice Pay one or more installments. Send any amount up to what is still owed.
    /// Each installment is due at startTime + n * interval. If any installment is paid
    /// after its due date, the finished loan counts as late in the borrower's reputation.
    function repay(uint256 loanId) external payable loanExists(loanId) {
        Loan storage l = loans[loanId];
        if (l.status != Status.Active) revert WrongStatus();
        if (msg.value == 0) revert ZeroAmount();
        if (l.repaid + msg.value > l.totalDue) revert ExceedsRemaining();

        l.repaid += msg.value;
        _creditLenders(loanId, msg.value, l.principal);

        uint256 perInstallment = l.totalDue / l.installments;
        uint256 covered = l.repaid >= l.totalDue ? l.installments : l.repaid / perInstallment;

        bool onTime = true;
        for (uint256 k = l.installmentsPaid + 1; k <= covered; k++) {
            if (block.timestamp > l.startTime + (k * l.intervalSeconds)) {
                l.lateInstallments++;
                onTime = false;
            }
        }
        l.installmentsPaid = covered;
        emit RepaymentMade(loanId, msg.value, covered, onTime);

        if (l.repaid == l.totalDue) {
            l.status = Status.Repaid;
            address[] storage gs = guarantors[loanId];
            for (uint256 i = 0; i < gs.length; i++) {
                withdrawable[gs[i]] += l.guarantorStake;
            }
            reputation.recordRepayment(l.borrower, l.lateInstallments == 0);
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
        uint256 slashed = guarantors[loanId].length * l.guarantorStake;
        _creditLenders(loanId, slashed, l.principal);

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

    /// @dev Return every guarantor stake and every lender contribution.
    function _refundAll(uint256 loanId, uint256 stake) private {
        address[] storage gs = guarantors[loanId];
        for (uint256 i = 0; i < gs.length; i++) {
            withdrawable[gs[i]] += stake;
        }
        address[] storage ls = lenders[loanId];
        for (uint256 i = 0; i < ls.length; i++) {
            withdrawable[ls[i]] += contributions[loanId][ls[i]];
        }
    }

    /// @dev Share an amount among lenders in proportion to what each contributed.
    function _creditLenders(uint256 loanId, uint256 amount, uint256 principal) private {
        address[] storage ls = lenders[loanId];
        if (ls.length == 0) return;
        uint256 distributed = 0;
        for (uint256 i = 0; i < ls.length; i++) {
            uint256 share = (amount * contributions[loanId][ls[i]]) / principal;
            withdrawable[ls[i]] += share;
            distributed += share;
        }
        // Rounding dust goes to the first lender
        if (distributed < amount) {
            withdrawable[ls[0]] += amount - distributed;
        }
    }
}