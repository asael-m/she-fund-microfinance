# SHE-Fund

**Blockchain microfinance for women entrepreneurs** (UN SDG 5: Gender Equality)

KCA University, CSN 4104 Blockchain Technologies and Applications, Project 04, Group 4
Lecturer: Mr. Dennis Mugambi Kaburu

| Member | Registration number |
| --- | --- |
| Griffin Mwendwa | 24/05653 |
| Shidhane Abdimajid Mohamed | 24/05208 |
| Isaac Mwangi | 22/04923 |
| Nichole Wanjiru | 22/02506 |

SHE-Fund is a prototype that lets women's self-help groups (SHGs) borrow through smart contracts. Group members guarantee each other's loans with locked deposits instead of physical collateral, lenders fund borrowers directly, every step is recorded on a public ledger, and a reputation score starts from an alternative-data scorecard and then follows each borrower's repayment record.

> **Prototype notice.** This project uses simulated data and a local test network. It is not audited and must not be used with real money.

## The problem and the answer

Women in Kenya hold mobile money accounts at the same rate as men, but women-owned businesses receive only 27% of outstanding MSME credit value (men-owned firms receive 73%), mainly because lending depends on collateral. SHE-Fund targets that credit gap:

| Pain point | Mechanism in SHE-Fund |
| --- | --- |
| Lack of collateral | Each guarantor locks 10% of the loan. It is refunded on repayment and slashed to lenders on default. |
| Opaque lending | An event is emitted for every step, so anyone can audit the ledger. |
| High intermediary fees | Lenders fund through an escrow contract and are repaid pro rata. No operator margin. |
| No credit history | A reputation score starts from a scorecard (300 to 700, set once), then moves with repayment behaviour. |

Full reasoning, diagrams and references are in the **System Design Document** and the **Final Report**.

## Features

- Three Solidity contracts: `Group`, `LoanPool`, `Reputation`
- Loan lifecycle with six states (Requested, Funded, Active, Repaid, Defaulted, Cancelled), funding and collection windows, automatic expiry, and a default grace period
- Reputation from 0 to 1000 (+20 for a fully on-time loan, -10 if any installment was late, -100 on default)
- Alternative-data scorecard in Python with a SHA-256 commitment stored on-chain; owner-only, once-only, capped between 300 and 700, with an audit event
- React web app that shows every role on one screen
- 41 custom automated tests (46 passing including Hardhat's sample tests)

## Loan parameters

| Parameter | Value |
| --- | --- |
| Interest | 5% flat |
| Guarantor stake | 10% of principal, per guarantor |
| Minimum score to borrow | 300 |
| Starting score | 500, or 300 to 700 if set once from alternative data |
| Funding window | 30 days |
| Collection window (after funding) | 7 days |
| Default grace period | 7 days after the final installment deadline |
| Limits | up to 120 installments; minimum principal 10^12 wei |

## Project structure

```
contracts/    Group.sol, LoanPool.sol, Reputation.sol
test/         Group.ts, LoanPool.ts, LoanPoolDeadlines.ts,
              Reputation.ts, ReputationStartingScore.ts
scripts/      demo.ts, deploy-local.ts, apply-ai-score.ts
ai/           score_mobile_money.py, data/mobile_money_sample.json
frontend/     React (Vite) web app
docs/         System Design Document, AI scoring notes
```

## Prerequisites

- Node.js (LTS) and npm
- Python 3 (standard library only, for the scorecard)
- Git

## Install and test

```
git clone https://github.com/asael-m/she-fund-microfinance
cd she-fund-microfinance
npm install
npx hardhat test
```

Expected: **46 passing** (43 Mocha and 3 Solidity), of which 41 are the project's own tests.

## Run the terminal demo

```
npx hardhat run scripts/demo.ts
```

It deploys the contracts, creates a group, and runs a full loan: request, guarantees, funding, withdrawal, four repayments. It ends with reputation 500 to 520, the lender able to withdraw 1.05 ETH, and each guarantor's 0.1 ETH stake refunded.

## Run the full system with the web app

Use two terminals in the project folder.

**Terminal 1** (leave running):

```
npx hardhat node
```

**Terminal 2:**

```
npx hardhat run scripts/deploy-local.ts --network localhost
python ai/score_mobile_money.py --input ai/data/mobile_money_sample.json --output ai/output/scores.json
npx hardhat run scripts/apply-ai-score.ts --network localhost
cd frontend
npm install
npm run dev
```

Open the address printed by `npm run dev` (usually `http://localhost:5173`). Use the **Account** dropdown to switch role:

| Account | Role | Starting score |
| --- | --- | --- |
| #0 | Group admin | 500 |
| #1 | Borrower | 669 |
| #2 | Guarantor 1 | 544 |
| #3 | Guarantor 2 | 523 |
| #4 | Lender | 500 |

**Happy path:** as #0 create the group and add members 1, 2 and 3; as #1 request a loan; as #2 and #3 click Guarantee; as #4 set the amount to 1 and click Fund; as #1 click Withdraw loan, set the amount to 0.2625 and click Repay four times (score 669 to 689); then #4, #2 and #3 withdraw their earnings and refunds.

**Default path:** repeat up to withdrawal with Loan ID 2, open **Developer tools**, advance time by **130 days** (120 days of installments plus the 7-day grace period; a shorter skip fails because the deadline has not passed), then click **Mark as defaulted**. The guarantors' stakes go to the lender and the borrower's score falls by 100.

## The scoring module

`ai/score_mobile_money.py` is a transparent, rule-based scorecard over simulated mobile-money data. It is **not** a trained machine-learning model. Weights: bills paid on time 35%, group savings consistency 30%, income stability 20%, account history 15%. It excludes gender, name, location, phone number and income level. The owner stores the resulting hash with `setDataHash` and the score with `setStartingScore`.

Trust assumption: the contract cannot check that a score matches the data, so the owner acts as an oracle. The design bounds this role (range 300 to 700, once only, public event with the data hash). See `docs/ai-scoring.md` and the design document for the fairness analysis.

## Networks

The demonstration runs on the local Hardhat network. A `celoSepolia` network entry (chain ID 11142220) is configured in `hardhat.config.ts` and reads its key from Hardhat's encrypted keystore, but **deployment to Celo was not completed**. The Graph is documented as an indexing plan in the design document and is not deployed.

## Security notes

- Never commit private keys, recovery phrases or `.env` files. `.gitignore` excludes them.
- The demo uses Hardhat's public test accounts, which are safe on a local chain only. Never send real funds to them.
- The contracts are an unaudited prototype.
- `npm audit` reports vulnerabilities in development dependencies. Do not run `npm audit fix --force`, because it can break Hardhat.

## Limitations

Simulated data and an unvalidated scorecard; a trusted owner acting as oracle; guarantees recover about 20% of the principal on default with two guarantors; no identity verification; reputation farming and score recovery are open problems; gas grows with the number of lenders on a loan; Celo not deployed; unaudited. The design document and report discuss each one.

## References

The four core sources are Hoque et al. (2024), Di Vaio et al. (2023), Pandhare et al. (2024) and Khalid and Kwok (2024). The full IEEE reference list is in the design document and the report.
