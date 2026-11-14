import { useEffect, useState } from "react";

// Shows the alternative-data starting score for the selected account.
// Props: reputation = ethers v6 Contract for Reputation, account = selected address,
//        refreshKey = any value that changes after a transaction (e.g. a counter).
export default function AltDataPanel({ reputation, account, refreshKey }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!reputation || !account) return;
      try {
        const events = await reputation.queryFilter(
          reputation.filters.StartingScoreSet(account)
        );
        const last = events[events.length - 1];
        if (!cancelled) {
          setInfo(
            last
              ? { score: last.args.score.toString(), hash: last.args.dataHash }
              : null
          );
        }
      } catch (err) {
        console.error("Could not read StartingScoreSet events", err);
        if (!cancelled) setInfo(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reputation, account, refreshKey]);

  return (
    <div className="card">
      <h3>Starting score (alternative data)</h3>
      {info ? (
        <>
          <p>
            <strong>{info.score}</strong> (allowed range 300-700)
          </p>
          <p style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>
            Data hash: {info.hash}
          </p>
          <p style={{ fontSize: "0.8rem" }}>
            Set once by the contract owner (a trusted oracle) from simulated
            mobile-money data. Repayments change the score from here.
          </p>
        </>
      ) : (
        <p>No starting score set. New borrowers begin at 500.</p>
      )}
    </div>
  );
}
