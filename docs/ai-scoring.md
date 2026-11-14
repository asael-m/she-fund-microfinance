# Alternative-data starting score (AI-assisted scoring module)

## Purpose

The project scope says SHE-Fund uses alternative data and blockchain-based reputation scores. Without this module, the `dataHash` stored in `Reputation` was never used and every new borrower started at 500. This module closes that gap: a simulated mobile-money history produces a starting score between 300 and 700, so women with no formal credit history but a record of paying bills and keeping up group savings can start from an evidence-based position.

## How it works

1. **Off-chain scoring.** `ai/score_mobile_money.py` reads simulated mobile-money data and computes a score from 300 to 700 with a weighted scorecard.
2. **Commitment.** The script produces a SHA-256 hash of the exact inputs, the model version, and the score. Only this hash goes on-chain, through the existing `setDataHash`. Personal data never leaves the off-chain store.
3. **On-chain step.** The owner calls `setStartingScore(borrower, score)` on `Reputation`. The contract emits `StartingScoreSet(borrower, score, dataHash)` and the usual `ScoreUpdated` event.
4. **Frontend.** The web app reads the `StartingScoreSet` event and shows the starting score and hash for the selected account.

## Contract rules (all tested)

| Rule | Reason |
| --- | --- |
| Owner only | Prevents anyone else from setting scores |
| A data hash must already be stored for the borrower | Ties every starting score to a committed dataset |
| Score must be 300 to 700, inclusive | Repayment history (which can reach 1000) must matter most; the floor of 300 equals the minimum score to borrow, so the model alone cannot lock a woman out |
| Works only for borrowers with no score history | An earned score, or an earlier starting score, can never be overwritten |
| Emits score and data hash in an event | Anyone can audit what was set, and when |

## The model

`scorecard-v1` is a simple weighted scorecard, not a trained machine-learning model. Four behaviour measures are combined and scaled to 300-700:

| Measure | Weight |
| --- | --- |
| Bills or airtime paid on time | 35% |
| Group (chama) savings contributions made vs expected | 30% |
| Steadiness of monthly inflows | 20% |
| Months of account activity (capped at 12) | 15% |

Small samples are pulled toward a neutral 0.5 (as if four neutral observations were added to each ratio, and the stability measure needs six months of data to be fully trusted). A borrower with no data on a measure receives exactly 0.5, so a thin file is not treated as a bad file, and a short perfect record is not trusted as much as a long one. The weights were chosen by the team and have not been validated against real repayment outcomes. The data in this prototype is simulated.

## Trust assumption: the owner is an oracle

The contract cannot check that the score matches the data. The owner computes the score off-chain and the contract trusts it, within the 300-700 limits. This is the same oracle problem that any use of off-chain data on a blockchain has. The design limits the damage in three ways: the range is capped, the score can be set only once, and every decision is public and tied to a data hash. The hash proves the data was not changed afterwards only when the data is shared with an auditor, who can recompute it. A production system would replace the single owner with several independent oracles, a multisig, or a privacy-preserving proof.

## Fairness note (risk of bias against women borrowers)

Credit models can disadvantage women even when they never use gender as an input. The design takes these precautions:

- **Excluded inputs:** gender, name, location, phone number, and the absolute amount of income. Using income levels would penalise low earners, who are more likely to be women in informal work.
- **Behaviour over size:** the model rewards reliability and consistency, not how much a woman earns.
- **Neutral treatment of missing data:** many women have shorter or sparser mobile-money records.

Risks remain. Behaviour measures can still act as proxies. For example, women who share phones or have less control over household money may show less regular activity, and seasonal income can look unstable. Before any real use, the team would need to test the model's outcomes by group on real data, tune the weights for fairness, and give borrowers a way to see and challenge their score.

## Limitations

- Simulated data, so the score has no proven predictive power.
- Single trusted owner.
- The stored `dataHash` can be replaced later with `setDataHash`. The `StartingScoreSet` event is the permanent record of the hash used at the time.
- One-time only: a mistaken starting score cannot be corrected on-chain.

## Files

| File | Role |
| --- | --- |
| `contracts/Reputation.sol` | Adds `setStartingScore`, its constants, event, and errors |
| `test/ReputationStartingScore.ts` | 8 tests for the rules above |
| `ai/score_mobile_money.py` | The scorecard and the hash |
| `ai/data/mobile_money_sample.json` | Simulated input for three demo borrowers |
| `scripts/apply-ai-score.ts` | Sends the hash and score on-chain |
| `frontend/src/AltDataPanel.jsx` | Shows the starting score in the web app |
