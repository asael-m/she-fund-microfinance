import { useState, useEffect, useCallback } from "react";
import { JsonRpcProvider, Contract, parseEther, formatEther } from "ethers";
import deployed from "./contracts.json";

const provider = new JsonRpcProvider("http://127.0.0.1:8545");
const ROLES = ["Admin", "Borrower", "Guarantor 1", "Guarantor 2", "Lender"];
const STATUS = ["Requested", "Funded", "Active", "Repaid", "Defaulted", "Cancelled"];

const css = `
body{font-family:system-ui,sans-serif;margin:0;background:#f4f6f8;color:#1b2430}
.wrap{max-width:980px;margin:0 auto;padding:20px}
h1{margin:0 0 4px} .sub{color:#5b6775;margin-bottom:16px}
.card{background:#fff;border-radius:10px;padding:16px;margin-bottom:14px;box-shadow:0 1px 3px #0001}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
label{display:block;font-size:12px;color:#5b6775;margin-top:8px}
input,select{width:100%;padding:7px;border:1px solid #cfd6dd;border-radius:6px;box-sizing:border-box}
button{margin-top:10px;padding:8px 12px;border:0;border-radius:6px;background:#0b7a5b;color:#fff;cursor:pointer}
button:hover{background:#095f47}
.stat{display:inline-block;margin-right:22px} .stat b{display:block;font-size:20px}
.log{font-family:monospace;font-size:13px;max-height:200px;overflow:auto}
.err{color:#b3261e}
`;

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [idx, setIdx] = useState(1);
  const [info, setInfo] = useState({});
  const [log, setLog] = useState([]);
  const [f, setF] = useState({
    groupName: "Mama Mboga SHG", groupId: "1", member: "1",
    principal: "1", installments: "4", days: "30", guarantors: "2",
    loanId: "1", amount: "0.2625", skip: "40",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const addLog = (m) => setLog((l) => [m, ...l].slice(0, 30));

  const contract = (name, runner) =>
    new Contract(deployed[name].address, deployed[name].abi, runner);
  const signed = async (name) => contract(name, await provider.getSigner(idx));

  const refresh = useCallback(async () => {
    try {
      const accs = (await provider.listAccounts()).map((a) => a.address);
      setAccounts(accs);
      const me = accs[idx];
      const rep = contract("Reputation", provider);
      const pool = contract("LoanPool", provider);
      const group = contract("Group", provider);
      const loanCount = Number(await pool.loanCount());
      let loan = null;
      const id = Number(f.loanId);
      if (id >= 1 && id <= loanCount) loan = await pool.getLoan(id);
      let grp = null;
      try { grp = await group.getGroup(f.groupId); } catch { /* no such group yet */ }
      setInfo({
        me, loanCount, loan, grp,
        score: await rep.getScore(me),
        balance: await provider.getBalance(me),
        withdrawable: await pool.withdrawable(me),
      });
    } catch {
      setInfo({ error: "Cannot reach the local node. Is Window 1 (npx hardhat node) running?" });
    }
  }, [idx, f.loanId, f.groupId]);

  useEffect(() => { refresh(); }, [refresh]);

  const run = async (label, fn) => {
    try {
      const tx = await fn();
      await tx.wait();
      addLog("OK: " + label);
    } catch (e) {
      addLog("FAILED: " + label + " (" + (e.revert?.name || e.shortMessage || e.message) + ")");
    }
    refresh();
  };

  const skipTime = async () => {
    await provider.send("evm_increaseTime", [Number(f.skip) * 86400]);
    await provider.send("evm_mine", []);
    addLog("Skipped " + f.skip + " days forward");
    refresh();
  };

  const L = info.loan;
  return (
    <div className="wrap">
      <style>{css}</style>
      <h1>SHE-Fund</h1>
      <div className="sub">Blockchain microfinance for women entrepreneurs (local demo)</div>

      <div className="card">
        <label>Acting as</label>
        <select value={idx} onChange={(e) => setIdx(Number(e.target.value))}>
          {ROLES.map((r, i) => (
            <option key={i} value={i}>Account #{i}: {r}</option>
          ))}
        </select>
        {info.error ? <p className="err">{info.error}</p> : (
          <div style={{ marginTop: 12 }}>
            <span className="stat">Reputation<b>{info.score?.toString()}</b></span>
            <span className="stat">Balance<b>{info.balance !== undefined ? Number(formatEther(info.balance)).toFixed(3) : "-"} ETH</b></span>
            <span className="stat">Withdrawable<b>{info.withdrawable !== undefined ? formatEther(info.withdrawable) : "-"} ETH</b></span>
          </div>
        )}
        <button onClick={() => run("Withdraw earnings and refunds", async () => (await signed("LoanPool")).withdraw())}>
          Withdraw my earnings / refunds
        </button>
      </div>

      <div className="grid">
        <div className="card">
          <h3>1. Group</h3>
          <label>Group name</label>
          <input value={f.groupName} onChange={set("groupName")} />
          <button onClick={() => run("Create group", async () => (await signed("Group")).createGroup(f.groupName))}>Create group</button>
          <label>Group ID</label>
          <input value={f.groupId} onChange={set("groupId")} />
          <label>Add member (account #)</label>
          <input value={f.member} onChange={set("member")} />
          <button onClick={() => run("Add member #" + f.member, async () => (await signed("Group")).addMember(f.groupId, accounts[Number(f.member)]))}>Add member</button>
          {info.grp && <p>{info.grp[0]}: {info.grp[2].toString()} members</p>}
        </div>

        <div className="card">
          <h3>2. Request a loan</h3>
          <label>Principal (ETH)</label>
          <input value={f.principal} onChange={set("principal")} />
          <label>Installments</label>
          <input value={f.installments} onChange={set("installments")} />
          <label>Days between installments</label>
          <input value={f.days} onChange={set("days")} />
          <label>Guarantors needed</label>
          <input value={f.guarantors} onChange={set("guarantors")} />
          <button onClick={() => run("Request loan", async () => (await signed("LoanPool")).requestLoan(
            f.groupId, parseEther(f.principal), f.installments, Number(f.days) * 86400, f.guarantors))}>
            Request loan
          </button>
        </div>

        <div className="card">
          <h3>3. Work on a loan</h3>
          <label>Loan ID</label>
          <input value={f.loanId} onChange={set("loanId")} />
          <button onClick={() => run("Guarantee loan " + f.loanId, async () => {
            const pool = await signed("LoanPool");
            const loan = await pool.getLoan(f.loanId);
            return pool.guarantee(f.loanId, { value: loan.guarantorStake });
          })}>Guarantee (lock stake)</button>
          <label>Amount (ETH) for funding or repaying</label>
          <input value={f.amount} onChange={set("amount")} />
          <button onClick={() => run("Fund loan " + f.loanId, async () => (await signed("LoanPool")).fund(f.loanId, { value: parseEther(f.amount) }))}>Fund</button>{" "}
          <button onClick={() => run("Withdraw loan " + f.loanId, async () => (await signed("LoanPool")).withdrawLoan(f.loanId))}>Withdraw loan</button>{" "}
          <button onClick={() => run("Repay loan " + f.loanId, async () => (await signed("LoanPool")).repay(f.loanId, { value: parseEther(f.amount) }))}>Repay</button>{" "}
          <button onClick={() => run("Cancel loan " + f.loanId, async () => (await signed("LoanPool")).cancelLoan(f.loanId))}>Cancel</button>
        </div>

        <div className="card">
          <h3>4. Default demo</h3>
          <label>Skip forward (days)</label>
          <input value={f.skip} onChange={set("skip")} />
          <button onClick={skipTime}>Skip time</button>{" "}
          <button onClick={() => run("Mark loan " + f.loanId + " as defaulted", async () => (await signed("LoanPool")).markDefault(f.loanId))}>Mark default</button>
          <p style={{ fontSize: 12, color: "#5b6775" }}>
            Skip past the loan deadline plus 7 days, then mark default to see stakes slashed and reputation drop.
          </p>
        </div>
      </div>

      <div className="card">
        <h3>Loan {f.loanId}</h3>
        {L ? (
          <p>
            Status: <b>{STATUS[Number(L.status)]}</b> | Principal {formatEther(L.principal)} ETH | Total due {formatEther(L.totalDue)} ETH |
            Funded {formatEther(L.funded)} | Repaid {formatEther(L.repaid)} | Borrower #{accounts.indexOf(L.borrower)}
          </p>
        ) : <p>No loan with this ID yet.</p>}
      </div>

      <div className="card">
        <h3>Activity</h3>
        <div className="log">{log.length ? log.map((m, i) => <div key={i} className={m.startsWith("FAILED") ? "err" : ""}>{m}</div>) : "Nothing yet."}</div>
      </div>
    </div>
  );
}