import { useState, useEffect, useRef, useMemo, useCallback } from "react";

/* ═══════════ persistence (cross-session, in-memory fallback) ═══════════ */
const _mem = {};
const store = {
  async get(k) {
    try { if (typeof window !== "undefined" && window.storage) { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } } catch (e) {}
    return _mem[k] ?? null;
  },
  async set(k, v) {
    _mem[k] = v;
    try { if (typeof window !== "undefined" && window.storage) await window.storage.set(k, JSON.stringify(v)); } catch (e) {}
  },
};

/* ═══════════ rule engine (verified) ═══════════ */
const half = (n) => Math.floor((n ?? 0) / 2);
const odd5 = (d) => (d % 2 === 1 ? [{ label: "odd → +5", value: 5 }] : []);
const t = (label, value) => ({ label, value });
const ORDER = [11, 12, 6, 7, 5, 9, 8, 4, 3];

const RULES = {
  11: { rule: "Add each digit to its right-hand neighbor.", fn: (d, n) => ({ terms: [t("digit", d), t("neighbor", n ?? 0)] }) },
  12: { rule: "Double each digit, add its neighbor.", fn: (d, n) => ({ terms: [t("2×digit", 2 * d), t("neighbor", n ?? 0)] }) },
  6:  { rule: "Add half the neighbor to the digit; +5 if the digit is odd.", fn: (d, n) => ({ terms: [t("digit", d), t("½ neighbor", half(n)), ...odd5(d)] }) },
  7:  { rule: "Double the digit, add half the neighbor; +5 if odd.", fn: (d, n) => ({ terms: [t("2×digit", 2 * d), t("½ neighbor", half(n)), ...odd5(d)] }) },
  5:  { rule: "Half the neighbor; +5 if the digit is odd.", fn: (d, n) => ({ terms: [t("½ neighbor", half(n)), ...odd5(d)] }) },
  9:  { rule: "Last: 10−digit · Middle: 9−digit+neighbor · Front: neighbor−1.",
        fn: (d, n, f, l) => f ? { terms: [t("10−digit", 10 - d)] } : l ? { terms: [t("neighbor−1", n - 1)] } : { terms: [t("9−digit", 9 - d), t("neighbor", n)] } },
  8:  { rule: "Last: 2(10−digit) · Middle: 2(9−digit)+neighbor · Front: neighbor−2.",
        fn: (d, n, f, l) => f ? { terms: [t("2(10−digit)", 2 * (10 - d))] } : l ? { terms: [t("neighbor−2", n - 2)] } : { terms: [t("2(9−digit)", 2 * (9 - d)), t("neighbor", n)] } },
  4:  { rule: "Last: 10−digit (+5 odd) · Middle: 9−digit (+5 odd) +½ neighbor · Front: ½ neighbor −1.",
        fn: (d, n, f, l) => f ? { terms: [t("10−digit", 10 - d), ...odd5(d)] } : l ? { terms: [t("½ neighbor", half(n)), t("−1", -1)] } : { terms: [t("9−digit", 9 - d), ...odd5(d), t("½ neighbor", half(n))] } },
  3:  { rule: "Last: 2(10−digit) (+5 odd) · Middle: 2(9−digit) (+5 odd) +½ neighbor · Front: ½ neighbor −2.",
        fn: (d, n, f, l) => f ? { terms: [t("2(10−digit)", 2 * (10 - d)), ...odd5(d)] } : l ? { terms: [t("½ neighbor", half(n)), t("−2", -2)] } : { terms: [t("2(9−digit)", 2 * (9 - d)), ...odd5(d), t("½ neighbor", half(n))] } },
};

function computeSteps(num, mult) {
  const padded = [0, ...String(num).split("").map(Number)];
  const steps = [];
  let carry = 0;
  for (let i = padded.length - 1; i >= 0; i--) {
    const d = padded[i], first = i === padded.length - 1, last = i === 0;
    const n = first ? null : padded[i + 1];
    const { terms } = RULES[mult].fn(d, n, first, last);
    const base = terms.reduce((s, x) => s + x.value, 0);
    const total = base + carry;
    const digit = last ? Math.max(0, total) : ((total % 10) + 10) % 10;
    const carryOut = last ? 0 : Math.floor(total / 10);
    steps.push({ i, d, n, first, last, terms, carryIn: carry, total, digit, carryOut });
    carry = carryOut;
  }
  return { padded, steps };
}

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const operandOfLen = (len) => { const lo = 10 ** (len - 1), hi = 10 ** len - 1; return randInt(Math.max(lo, 11), hi); };

function diagnose(steps, entered) {
  const issues = new Set();
  for (let k = 0; k < entered.length; k++) {
    const s = steps[Math.min(k, steps.length - 1)];
    if (s.last && String(s.digit).length > 1) continue;
    const e = parseInt(entered[entered.length - 1 - k], 10);
    if (isNaN(e) || e === s.digit) continue;
    const delta = (((s.digit - e) % 10) + 10) % 10;
    const hadOdd5 = s.terms.some((x) => x.value === 5 && /odd/.test(x.label));
    if (hadOdd5 && delta === 5) issues.add("the +5 on odd digits");
    else if (s.carryIn > 0 && delta === s.carryIn % 10) issues.add("adding the carry");
    else if (s.terms.some((x) => /½/.test(x.label))) issues.add("halving the neighbor");
    else issues.add("a column value");
  }
  return [...issues];
}

/* ═══════════ skill model ═══════════ */
const blankSkill = () => ({ last: [], seen: 0, correct: 0 });
const mastery = (sk) => (sk.last.length ? sk.last.reduce((a, b) => a + b, 0) / sk.last.length : 0);
const fadeLevel = (sk) => { const m = mastery(sk); if (sk.last.length < 3 || m < 0.5) return 0; if (m < 0.85) return 1; return 2; };
const FADE = ["Guided", "Prompted", "Bare"];

function freshState() {
  const skills = {};
  ORDER.forEach((m) => (skills[m] = blankSkill()));
  return { skills, unlocked: [11, 12], totalProblems: 0 };
}

/* ═══════════ root ═══════════ */
export default function App() {
  const [tab, setTab] = useState("session");
  const [data, setData] = useState(null);
  const saveTimer = useRef(null);

  useEffect(() => { (async () => setData((await store.get("tt")) || freshState()))(); }, []);
  const persist = useCallback((next) => { setData(next); clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => store.set("tt", next), 250); }, []);

  const recordFull = useCallback((m, ok) => {
    setData((prev) => {
      const d = structuredClone(prev);
      const sk = d.skills[m];
      sk.seen += 1; if (ok) sk.correct += 1;
      sk.last = [...sk.last, ok ? 1 : 0].slice(-5);
      d.totalProblems += 1;
      const allSolid = d.unlocked.every((u) => mastery(d.skills[u]) >= 0.8 && d.skills[u].last.length >= 4);
      if (allSolid && d.unlocked.length < ORDER.length) d.unlocked.push(ORDER[d.unlocked.length]);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => store.set("tt", d), 250);
      return d;
    });
  }, []);

  if (!data) return <div className="tt-root"><Style /><div className="loading">loading your progress…</div></div>;

  return (
    <div className="tt-root">
      <Style />
      <header className="tt-head">
        <div className="hi">
          <div>
            <div className="eyebrow">Trachtenberg speed-arithmetic trainer</div>
            <h1>right <span className="amp">→</span> left</h1>
          </div>
          <nav className="tabs">
            {[["session", "Session"], ["drills", "Sub-drills"], ["learn", "Learn"], ["method", "Method"], ["why", "Why"], ["progress", "Progress"]].map(([k, label]) => (
              <button key={k} className={tab === k ? "on" : ""} aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
            ))}
          </nav>
        </div>
      </header>
      {tab === "session" && <Session data={data} record={recordFull} />}
      {tab === "drills" && <Drills />}
      {tab === "learn" && <Learn unlocked={data.unlocked} />}
      {tab === "method" && <Method />}
      {tab === "why" && <Why />}
      {tab === "progress" && <Progress data={data} reset={() => persist(freshState())} />}
    </div>
  );
}

/* ═══════════ adaptive session ═══════════ */
function pickMultiplier(data) {
  const pool = data.unlocked;
  if (Math.random() < 0.6) return [...pool].sort((a, b) => (mastery(data.skills[a]) - mastery(data.skills[b])) || (data.skills[a].seen - data.skills[b].seen))[0];
  return pool[randInt(0, pool.length - 1)];
}
function pickLength(sk) { const m = mastery(sk); if (m < 0.6 || sk.last.length < 3) return 2; if (m < 0.85) return 3; return randInt(3, 4); }

function Session({ data, record }) {
  const [prob, setProb] = useState(null);
  const [entries, setEntries] = useState([]);
  const [phase, setPhase] = useState("go");
  const [issues, setIssues] = useState([]);
  const [showHelp, setShowHelp] = useState(false);
  const [start, setStart] = useState(0);
  const [times, setTimes] = useState([]);
  const refs = useRef([]);

  const newProblem = useCallback(() => {
    const m = pickMultiplier(data);
    const sk = data.skills[m];
    const fade = fadeLevel(sk);
    const n = operandOfLen(pickLength(sk));
    const ans = String(n * m);
    setProb({ n, m, ans, fade });
    setEntries(Array(ans.length).fill(""));
    setPhase("go"); setIssues([]); setShowHelp(fade === 0); setStart(Date.now());
    setTimeout(() => refs.current[ans.length - 1]?.focus(), 40);
  }, [data]);

  useEffect(() => { newProblem(); /* eslint-disable-next-line */ }, []);

  const steps = useMemo(() => (prob ? computeSteps(prob.n, prob.m).steps : []), [prob]);
  if (!prob) return null;

  const setDigit = (i, v) => { const next = [...entries]; next[i] = v.replace(/\D/g, "").slice(-1); setEntries(next); if (next[i] !== "" && i > 0) refs.current[i - 1]?.focus(); };
  const filled = entries.every((e) => e !== "");
  const check = () => {
    const ok = entries.join("") === prob.ans;
    if (ok) { setPhase("right"); setTimes((tt) => [...tt, Date.now() - start].slice(-20)); record(prob.m, true); }
    else { setPhase("wrong"); setIssues(diagnose(steps, entries)); record(prob.m, false); }
  };

  const sk = data.skills[prob.m];
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length / 100) / 10 : null;
  const lastSecs = Math.round((Date.now() - start) / 100) / 10;

  return (
    <main className="wrap">
      <div className="sess-top">
        <span className="badge">×{prob.m}</span>
        <span className="fade-pill" title="how much help you're getting now">{FADE[prob.fade]}</span>
        <span className="sk-bar" aria-hidden><i style={{ width: `${mastery(sk) * 100}%` }} /></span>
        <span className="spacer" />
        {avg != null && <span className="metric">avg <b>{avg}s</b></span>}
      </div>
      <div className="card drill">
        <div className="prob"><span className="pn">{prob.n}</span><span className="px">× {prob.m}</span></div>
        {prob.fade <= 1 && (showHelp || prob.fade === 0) && (<div className="ruleline"><span className="tag">rule</span>{RULES[prob.m].rule}</div>)}
        <div className="cells">
          {entries.map((v, i) => (
            <input key={i} ref={(el) => (refs.current[i] = el)} inputMode="numeric" maxLength={1}
              className={"cell" + (phase === "right" ? " ok" : phase === "wrong" && v !== prob.ans[i] ? " bad" : "")}
              value={v} disabled={phase === "right"} aria-label={`digit ${i + 1}`}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Backspace" && v === "" && i < entries.length - 1) refs.current[i + 1]?.focus(); if (e.key === "Enter" && filled && phase === "go") check(); }} />
          ))}
        </div>
        <div className="note">enter right → left</div>
        {phase === "go" && (
          <div className="acts">
            <button className="btn primary" disabled={!filled} onClick={check}>Check</button>
            {prob.fade === 2 && <button className="btn ghost" onClick={() => setShowHelp((s) => !s)}>{showHelp ? "Hide rule" : "Show rule"}</button>}
            <button className="btn ghost" onClick={newProblem}>Skip</button>
          </div>
        )}
        {phase === "right" && (<div className="acts"><span className="verdict ok">Correct · {lastSecs}s.</span><button className="btn primary" onClick={newProblem}>Next →</button></div>)}
        {phase === "wrong" && (
          <div className="diag">
            <div className="acts"><span className="verdict bad">{prob.n} × {prob.m} = {prob.ans}. Wrong cells marked.</span></div>
            {issues.length > 0 && <div className="issue">Likely slip: <b>{issues.join(", ")}</b>.{(issues.includes("the +5 on odd digits") || issues.includes("halving the neighbor")) ? " The Sub-drills tab isolates that." : ""}</div>}
            <StepStrip steps={steps} />
            <div className="acts"><button className="btn ghost" onClick={() => setPhase("go")}>Re-enter</button><button className="btn primary" onClick={newProblem}>Next →</button></div>
          </div>
        )}
        {showHelp && prob.fade >= 1 && phase === "go" && <StepStrip steps={steps} muted />}
      </div>
      <p className="explainer">Problems lean toward your weakest multiplier, lengths grow as you improve, and the help — rule text, then worked columns — drops away on its own once a multiplier is solid.</p>
    </main>
  );
}

function StepStrip({ steps, muted }) {
  const ordered = [...steps].reverse();
  return (
    <div className={"strip" + (muted ? " muted" : "")}>
      {ordered.map((s, idx) => (
        <div className="scol" key={idx}>
          <div className="scol-calc">
            {s.terms.map((x, i) => <span key={i}>{i > 0 && x.value >= 0 ? "+" : ""}{x.value < 0 ? `−${-x.value}` : x.value}</span>)}
            {s.carryIn > 0 && <span className="cy">+{s.carryIn}</span>}
          </div>
          <div className="scol-eq">{s.total}</div>
          <div className="scol-out">{s.digit}{s.carryOut > 0 ? <sup>c{s.carryOut}</sup> : null}</div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════ sub-skill micro-drills ═══════════ */
function Drills() {
  const [kind, setKind] = useState(null);
  if (kind === "half") return <RapidDrill key="h" title="Halve & drop" hint="Type ⌊n/2⌋ — throw away the fraction. Half of 7 is 3."
    gen={() => { const n = randInt(0, 9); return { prompt: `½ of ${n}`, answer: String(half(n)) }; }} back={() => setKind(null)} />;
  if (kind === "odd") return <RapidDrill key="o" title="Odd → +5 reflex" hint="Does this digit trigger the +5? Tap." choices
    gen={() => { const n = randInt(0, 9); return { prompt: String(n), answer: n % 2 === 1 ? "+5" : "no", options: ["+5", "no"] }; }} back={() => setKind(null)} />;
  if (kind === "col") return <ColumnDrill back={() => setKind(null)} />;
  return (
    <main className="wrap">
      <p className="explainer top">Full problems train the whole pipeline at once. These isolate the single operations that bottleneck it — drill the slow one alone and the full method speeds up underneath you.</p>
      <div className="menu">
        <button className="mcard" onClick={() => setKind("half")}><div className="mc-x">½</div><div className="mc-t">Halve &amp; drop</div><div className="mc-d">Floor-halving on sight, 0–9. The single most-used move in the ×6/7/5/4/3 rules.</div></button>
        <button className="mcard" onClick={() => setKind("odd")}><div className="mc-x">5</div><div className="mc-t">Odd → +5 reflex</div><div className="mc-d">Snap-judge whether a digit adds 5. Should be automatic, not calculated.</div></button>
        <button className="mcard" onClick={() => setKind("col")}><div className="mc-x">▦</div><div className="mc-t">Single column</div><div className="mc-d">One digit, one neighbor, one multiplier — give just that column's value, no carries.</div></button>
      </div>
    </main>
  );
}

function RapidDrill({ title, hint, gen, back, choices }) {
  const [q, setQ] = useState(gen);
  const [val, setVal] = useState("");
  const [flash, setFlash] = useState(null);
  const [run, setRun] = useState({ n: 0, ok: 0, t0: Date.now() });
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, [q]);
  const submit = (answer) => {
    const ok = answer === q.answer;
    setFlash(ok ? "ok" : "bad");
    setRun((r) => ({ n: r.n + 1, ok: r.ok + (ok ? 1 : 0), t0: r.t0 }));
    setTimeout(() => { setFlash(null); setVal(""); setQ(gen()); }, ok ? 160 : 650);
  };
  const rate = run.n ? Math.round((run.ok / run.n) * 100) : 0;
  const perMin = run.n ? Math.round((run.n / ((Date.now() - run.t0) / 60000)) || 0) : 0;
  return (
    <main className="wrap">
      <button className="back" onClick={back}>← drills</button>
      <div className="rapid-head"><h2>{title}</h2><div className="rapid-stats"><span><b>{run.n}</b> done</span><span><b>{rate}%</b></span><span><b>{perMin}</b>/min</span></div></div>
      <div className="hint">{hint}</div>
      <div className={"rapid card" + (flash ? " f-" + flash : "")}>
        <div className="rapid-q">{q.prompt}</div>
        {choices ? (
          <div className="rapid-choices">{q.options.map((o) => <button key={o} className="bigbtn" onClick={() => submit(o)}>{o}</button>)}</div>
        ) : (
          <input ref={ref} className="rapid-in" inputMode="numeric" value={val} disabled={!!flash}
            onChange={(e) => setVal(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter" && val !== "") submit(val); }} placeholder="?" />
        )}
        {!choices && <button className="btn primary" disabled={val === "" || !!flash} onClick={() => submit(val)}>Go</button>}
      </div>
    </main>
  );
}

function ColumnDrill({ back }) {
  const mkQ = () => {
    const m = ORDER[randInt(0, ORDER.length - 1)];
    const d = randInt(0, 9), n = randInt(0, 9);
    const { terms } = RULES[m].fn(d, n, false, false);
    const value = terms.reduce((s, x) => s + x.value, 0);
    return { m, d, n, answer: String(((value % 10) + 10) % 10) };
  };
  const [q, setQ] = useState(mkQ);
  const [val, setVal] = useState("");
  const [flash, setFlash] = useState(null);
  const [reveal, setReveal] = useState(false);
  const [run, setRun] = useState({ n: 0, ok: 0 });
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, [q]);
  const submit = () => {
    const ok = val === q.answer; setFlash(ok ? "ok" : "bad");
    setRun((r) => ({ n: r.n + 1, ok: r.ok + (ok ? 1 : 0) }));
    setTimeout(() => { setFlash(null); setVal(""); setReveal(false); setQ(mkQ()); }, ok ? 200 : 900);
  };
  return (
    <main className="wrap">
      <button className="back" onClick={back}>← drills</button>
      <div className="rapid-head"><h2>Single column</h2><div className="rapid-stats"><span><b>{run.n}</b></span><span><b>{run.n ? Math.round(run.ok / run.n * 100) : 0}%</b></span></div></div>
      <div className="hint">Apply the ×{q.m} rule to this column and give the digit you'd write (ignore carry-in). Tap the rule if you blank.</div>
      <div className={"rapid card" + (flash ? " f-" + flash : "")}>
        <div className="col-q"><span className="cqx">×{q.m}</span><span className="cqd">digit {q.d}</span><span className="cqn">neighbor {q.n}</span></div>
        <input ref={ref} className="rapid-in" inputMode="numeric" value={val} disabled={!!flash} maxLength={1}
          onChange={(e) => setVal(e.target.value.replace(/\D/g, "").slice(-1))}
          onKeyDown={(e) => { if (e.key === "Enter" && val !== "") submit(); }} placeholder="?" />
        <div className="acts">
          <button className="btn primary" disabled={val === "" || !!flash} onClick={submit}>Go</button>
          <button className="btn ghost" onClick={() => setReveal((r) => !r)}>{reveal ? "Hide rule" : "Rule"}</button>
        </div>
        {reveal && <div className="ruleline sm"><span className="tag">×{q.m}</span>{RULES[q.m].rule}</div>}
      </div>
    </main>
  );
}

/* ═══════════ plain method recipes ═══════════ */
const METHOD = {
  11: { sum: "Add each digit to its right-hand neighbor.",
    right: "Bring the rightmost digit down unchanged.",
    mid: "Add the digit to the digit on its right.",
    lead: "Bring the leading digit down (plus any carry)." },
  12: { sum: "Double each digit, then add its right-hand neighbor.",
    right: "Double the rightmost digit.",
    mid: "Double the digit, then add the digit on its right.",
    lead: "Bring the leading digit down (plus any carry)." },
  6:  { sum: "Add half the neighbor to each digit; add 5 if the digit is odd.",
    right: "Take the rightmost digit; add 5 if it is odd.",
    mid: "Digit + half its right neighbor (drop any fraction) + 5 if the digit is odd.",
    lead: "Half the leading digit (plus any carry)." },
  7:  { sum: "Double each digit, add half the neighbor; add 5 if the digit is odd.",
    right: "Double the rightmost digit; add 5 if it is odd.",
    mid: "(2 × digit) + half its right neighbor + 5 if the digit is odd.",
    lead: "Half the leading digit (plus any carry)." },
  5:  { sum: "Take half the neighbor; add 5 if the digit is odd. The digit only matters for odd/even.",
    right: "Write 5 if the rightmost digit is odd, otherwise 0.",
    mid: "Half the right neighbor (drop any fraction) + 5 if the digit is odd.",
    lead: "Half the leading digit (plus any carry)." },
  9:  { sum: "Subtract from 10 on the right, from 9 in the middle, knock 1 off the front.",
    right: "10 − the rightmost digit.",
    mid: "(9 − the digit) + its right neighbor.",
    lead: "The leading digit − 1 (plus any carry)." },
  8:  { sum: "Like ×9, but everything you subtract is doubled, and you knock 2 off the front.",
    right: "2 × (10 − the rightmost digit).",
    mid: "2 × (9 − the digit) + its right neighbor.",
    lead: "The leading digit − 2 (plus any carry)." },
  4:  { sum: "Subtraction with the odd-+5 and half-neighbor added in.",
    right: "(10 − the digit), then + 5 if the digit is odd.",
    mid: "(9 − the digit), + 5 if the digit is odd, + half its right neighbor.",
    lead: "Half the leading digit, then − 1 (plus any carry)." },
  3:  { sum: "×4's recipe with the subtraction part doubled.",
    right: "2 × (10 − the digit), then + 5 if the digit is odd.",
    mid: "2 × (9 − the digit), + 5 if the digit is odd, + half its right neighbor.",
    lead: "Half the leading digit, then − 2 (plus any carry)." },
};

function WorkedTrace({ num, mult }) {
  const { steps } = computeSteps(num, mult);
  const ordered = [...steps].reverse();
  return (
    <div className="wt">
      {ordered.map((s, i) => (
        <div className="wt-row" key={i}>
          <span className="wt-pos">{s.first ? "ones" : s.last ? "front 0" : `digit ${s.d}`}</span>
          <span className="wt-calc">
            {s.terms.map((x, j) => <span key={j}>{j > 0 ? (x.value < 0 ? " − " : " + ") : (x.value < 0 ? "− " : "")}{Math.abs(x.value)}<i>{x.label}</i></span>)}
            {s.carryIn > 0 && <span> + {s.carryIn}<i>carry</i></span>}
            <span className="wt-eq"> = {s.total}</span>
          </span>
          <span className="wt-out">{s.digit}{s.carryOut > 0 ? <em> c{s.carryOut}</em> : null}</span>
        </div>
      ))}
    </div>
  );
}

function Method() {
  const [num, setNum] = useState(538);
  const [openTrace, setOpenTrace] = useState(null);
  return (
    <main className="wrap">
      <p className="explainer top">The plain procedure for every rule — no theory needed. Three universal steps first, then each multiplier's recipe with a full worked example.</p>

      <div className="card universal">
        <div className="frame-h">Every rule, same three habits</div>
        <ol className="ulist">
          <li>Write the number with a <b>0 in front</b> (e.g. 538 → 0538).</li>
          <li>Work <b>right to left</b>, one digit at a time. "Neighbor" always means the digit <b>immediately to the right</b>.</li>
          <li>Each step gives a running total: <b>write its last digit, carry the rest</b> (the tens) into the next step on the left.</li>
        </ol>
      </div>

      <div className="method-num">
        <label htmlFor="mnum">Worked example uses this number:</label>
        <input id="mnum" inputMode="numeric" value={num}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 5); setNum(v === "" ? "" : parseInt(v, 10)); }}
          onBlur={() => { if (num === "" || num < 10) setNum(538); }} />
        <span className="method-hint">type any 2–5 digit number</span>
      </div>

      {ORDER.map((m) => {
        const me = METHOD[m];
        const n = num === "" ? 538 : num;
        const open = openTrace === m;
        return (
          <div className="card mcard-full" key={m}>
            <div className="mfh"><span className="mfx">×{m}</span><span className="mfs">{me.sum}</span></div>
            <div className="steps3">
              <div className="s3"><span className="s3-l">Rightmost digit</span><span className="s3-t">{me.right}</span></div>
              <div className="s3"><span className="s3-l">Each middle digit</span><span className="s3-t">{me.mid}</span></div>
              <div className="s3"><span className="s3-l">Leading 0 (last step)</span><span className="s3-t">{me.lead}</span></div>
            </div>
            <div className="mfx-ex">
              <span className="ex-line">{n} × {m} = <b>{n * m}</b></span>
              <button className="why-toggle" onClick={() => setOpenTrace(open ? null : m)}>{open ? "hide working ▲" : "show working ▼"}</button>
            </div>
            {open && <WorkedTrace num={n} mult={m} />}
          </div>
        );
      })}
    </main>
  );
}

/* ═══════════ decomposition framework ═══════════ */
// every multiplier = base (10 or 5) + k copies of the digit (k can be negative)
const DECOMP = {
  11: { base: 10, k: 1 }, 12: { base: 10, k: 2 }, 9: { base: 10, k: -1 }, 8: { base: 10, k: -2 },
  5: { base: 5, k: 0 }, 6: { base: 5, k: 1 }, 7: { base: 5, k: 2 }, 4: { base: 5, k: -1 }, 3: { base: 5, k: -2 },
};
const FIVE_TABLE = Array.from({ length: 10 }, (_, d) => ({ d, prod: 5 * d, tens: Math.floor(d / 2), units: d % 2 ? 5 : 0 }));

const engineLabel = (base) => base === 10 ? "the neighbor" : "half the neighbor (+5 if the digit is odd)";
const digitPart = (k) => k === 0 ? "nothing from the digit itself" : `${Math.abs(k) === 2 ? "twice " : ""}the digit, ${k > 0 ? "added" : "subtracted"}`;

// long-form, per-rule "why" prose
function whyText(m) {
  const { base, k } = DECOMP[m];
  const sign = k < 0 ? "−" : "+";
  const copies = Math.abs(k);
  const out = [];
  out.push({ h: "The decomposition", p: `${m} = ${base} ${sign} ${copies === 0 ? 0 : copies === 1 ? "1" : "2"}. So multiplying by ${m} means "multiply by ${base}" and then ${k === 0 ? "stop" : `${k > 0 ? "add" : "subtract"} ${copies === 2 ? "two copies of" : "one copy of"} the original number"`}. Worked one column at a time, that turns into: take ${engineLabel(base)}, then ${digitPart(k)}.` });

  if (base === 10) {
    out.push({ h: "Why the neighbor appears", p: `Multiplying by 10 shifts every digit one place to the left. So the part of ×10 that lands in your current column is simply the digit sitting to its right — its neighbor. That is the whole "×10 engine": the neighbor, nothing computed.` });
  } else {
    out.push({ h: "Why half the neighbor, plus 5 for odd", p: `Look at what 5×d does to a single digit (table below). The units of 5×d are 5 when d is odd and 0 when even; the tens of 5×d are exactly ⌊d/2⌋. Working right to left, your column collects the tens from the neighbor's 5×(neighbor) — that is ⌊neighbor/2⌋, the "half the neighbor" — plus the units from your own 5×(digit), which drops a 5 in only when the digit is odd. The half-neighbor and the +5 are not two rules; they are the two halves of one multiplication by 5.` });
  }

  if (k < 0) {
    out.push({ h: "Why subtraction shows up as 9 − digit", p: `${m} = ${base} − ${copies}, so ${m}N = ${base}N − ${copies}N. The ${base}N part supplies ${base === 10 ? "the neighbor" : "the half-neighbor"}; the −${copies}N subtracts ${copies === 2 ? "twice " : ""}the digit. Doing "neighbor − digit" straight would make columns go negative, so each column borrows ${copies === 2 ? "up to 20" : "10"} to stay non-negative and then repays the ${copies} it borrowed earlier. That is why a middle column reads ${copies === 2 ? "2(9 − digit)" : "9 − digit"} + neighbor: the ${copies === 2 ? "18" : "9"} is ${copies === 2 ? "20 borrowed − 2 repaid" : "10 borrowed − 1 repaid"}. The rightmost column owes no repayment yet (${copies === 2 ? "2(10 − digit)" : "10 − digit"}), and the leading digit only settles the final borrow (neighbor − ${copies}).` });
  } else if (k > 0) {
    out.push({ h: copies === 2 ? "Why the digit is doubled" : "Why one digit is added", p: `${m} = ${base} + ${copies}, so after the ${base}-engine you add ${copies === 2 ? "two copies of" : "one copy of"} the digit itself. ${copies === 2 ? "Double the digit before adding — and judge oddness on the original digit, not the doubled value." : "Just add the plain digit."}` });
  }

  // concrete column example
  const dEx = 7, nEx = 4;
  const { terms } = RULES[m].fn(dEx, nEx, false, false);
  const val = terms.reduce((s, x) => s + x.value, 0);
  out.push({ h: "One column, worked", p: `Digit 7, neighbor 4, ×${m}:  ${terms.map((x, i) => `${i > 0 && x.value >= 0 ? "+ " : ""}${x.value < 0 ? `− ${-x.value}` : x.value} (${x.label})`).join("  ")}  =  ${val}.  Write ${((val % 10) + 10) % 10}${Math.floor(val / 10) > 0 ? `, carry ${Math.floor(val / 10)}` : ""}.` });
  return out;
}

function Why() {
  const [open, setOpen] = useState(null);
  return (
    <main className="wrap">
      <p className="explainer top">Nine rules look like nine things to memorize. They are one idea: every multiplier is <b>10 or 5, plus or minus a copy or two of the digit</b>, applied column by column. Learn the two engines below and the table writes itself.</p>

      <div className="card engine-card">
        <div className="eng-h"><span className="eng-n">×10</span><span className="eng-t">the neighbor engine</span></div>
        <p className="eng-p">Multiplying by 10 shifts every digit one place left. The digit that lands in your column from a ×10 is just the one to its right — the <b>neighbor</b>. So any rule built on 10 reads the full neighbor, no arithmetic. Rules ×11, ×12, ×9, ×8 all sit on this engine.</p>
      </div>

      <div className="card engine-card">
        <div className="eng-h"><span className="eng-n">×5</span><span className="eng-t">the half-neighbor engine</span></div>
        <p className="eng-p">This is the engine people memorize without understanding. It comes straight out of what 5×d does to one digit:</p>
        <table className="ftable">
          <thead><tr><th>d</th><th>5 × d</th><th>tens = ⌊d/2⌋</th><th>units</th></tr></thead>
          <tbody>{FIVE_TABLE.map((r) => (
            <tr key={r.d}><td>{r.d}</td><td>{String(r.prod).padStart(2, "0")}</td><td className="hl">{r.tens}</td><td className={r.units ? "hl5" : ""}>{r.units}</td></tr>
          ))}</tbody>
        </table>
        <p className="eng-p">Read the two right columns: the <b>tens of 5×d are exactly half of d (rounded down)</b>, and the <b>units are 5 when d is odd, 0 when even</b>. Working right to left, your column picks up the tens from the <i>neighbor's</i> ×5 (that's "half the neighbor") and the units from your <i>own</i> digit's ×5 (that's "+5 if odd"). One multiplication, split across two columns. Rules ×5, ×6, ×7, ×4, ×3 all sit on this engine.</p>
      </div>

      <div className="card">
        <div className="frame-h">The whole system in one table</div>
        <p className="eng-p sm">Tap a row to see it split into engine + digit part.</p>
        <table className="dtable">
          <thead><tr><th>×</th><th>=</th><th>engine</th><th>digit part</th></tr></thead>
          <tbody>
            {[11, 12, 9, 8, 5, 6, 7, 4, 3].map((m) => {
              const { base, k } = DECOMP[m];
              const active = open === m;
              return (
                <tr key={m} className={active ? "drow on" : "drow"} onClick={() => setOpen(active ? null : m)}>
                  <td className="dm">×{m}</td>
                  <td className="deq">{base} {k < 0 ? "−" : "+"} {Math.abs(k)}</td>
                  <td className={base === 10 ? "dbase ten" : "dbase five"}>{base === 10 ? "neighbor" : "½ neighbor +5odd"}</td>
                  <td className="ddig">{k === 0 ? "—" : `${k > 0 ? "+" : "−"} ${Math.abs(k) === 2 ? "2×" : ""}digit`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="eng-p sm">×3 is taught last because it is the only rule stacking both hard parts — the 5-engine <i>and</i> a doubled subtraction. Nothing new, just both at once.</p>
      </div>

      <div className="card">
        <div className="frame-h">Full derivation, per rule</div>
        <p className="eng-p sm">Pick a multiplier for the complete why.</p>
        <div className="picker">{[11, 12, 9, 8, 5, 6, 7, 4, 3].map((m) => <button key={m} className={"chip" + (open === m ? " on" : "")} onClick={() => setOpen(open === m ? null : m)}>×{m}</button>)}</div>
        {open && (
          <div className="why-body">
            <div className="why-rule"><span className="tag">×{open} rule</span>{RULES[open].rule}</div>
            {whyText(open).map((b, i) => (
              <div className="why-block" key={i}><div className="why-bh">{b.h}</div><p className="why-bp">{b.p}</p></div>
            ))}
          </div>
        )}
      </div>

      <div className="card gotcha">
        <div className="frame-h">The three slips that cause most errors</div>
        <ol className="glist">
          <li><b>Half means floor.</b> Half of 7 is 3, not 3.5. The dropped half is already paid for by the +5-if-odd on the other number — don't count it twice.</li>
          <li><b>Judge oddness on the original digit.</b> For ×7 and ×3 you double the digit <i>and</i> add 5 if the digit was odd — decide odd/even before doubling.</li>
          <li><b>The leading zero is a real step.</b> Padding a 0 on the left is where the final carry or borrow becomes the top digit of the answer. Skip it and a multi-digit answer comes out one digit short.</li>
        </ol>
      </div>
    </main>
  );
}

/* ═══════════ learn (walkthrough reference) ═══════════ */
function Learn({ unlocked }) {
  const [mult, setMult] = useState(11);
  const [num, setNum] = useState(623);
  const [step, setStep] = useState(-1);
  const [showWhy, setShowWhy] = useState(false);
  useEffect(() => setStep(-1), [mult, num]);
  const { padded, steps } = useMemo(() => computeSteps(num, mult), [num, mult]);
  const cur = step >= 0 ? steps[Math.min(step, steps.length - 1)] : null;
  const done = step >= steps.length - 1;
  const ans = num * mult;
  return (
    <main className="wrap">
      <div className="picker">{ORDER.map((m) => <button key={m} className={"chip" + (m === mult ? " on" : "") + (unlocked.includes(m) ? "" : " lock")} onClick={() => setMult(m)}>×{m}{unlocked.includes(m) ? "" : " 🔒"}</button>)}</div>
      <div className="ruleline big"><span className="tag">×{mult}</span>{RULES[mult].rule}<button className="why-toggle" onClick={() => setShowWhy((s) => !s)}>{showWhy ? "hide why ▲" : "why does this work? ▼"}</button></div>
      {showWhy && (
        <div className="card why-inline">
          <div className="why-body">
            {whyText(mult).map((b, i) => (<div className="why-block" key={i}><div className="why-bh">{b.h}</div><p className="why-bp">{b.p}</p></div>))}
            {DECOMP[mult].base === 5 && (
              <table className="ftable mini">
                <thead><tr><th>d</th><th>5×d</th><th>⌊d/2⌋</th><th>units</th></tr></thead>
                <tbody>{FIVE_TABLE.map((r) => <tr key={r.d}><td>{r.d}</td><td>{String(r.prod).padStart(2, "0")}</td><td className="hl">{r.tens}</td><td className={r.units ? "hl5" : ""}>{r.units}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </div>
      )}
      <div className="card">
        <div className="prob lh">
          <div className="digit-row">
            {padded.map((d, i) => { const hot = cur && cur.i === i, nb = cur && !cur.first && cur.i + 1 === i;
              return <span key={i} className={"dg" + (i === 0 ? " pad" : "") + (hot ? " hot" : "") + (nb ? " nb" : "")}>{d}{hot && <em>digit</em>}{nb && <em className="n">nbr</em>}</span>; })}
          </div>
          <span className="px">× {mult}</span>
        </div>
        <div className="acts">
          <button className="btn ghost" disabled={step < 0} onClick={() => setStep((s) => Math.max(-1, s - 1))}>← Back</button>
          <button className="btn primary" disabled={done && step >= 0} onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}>{step < 0 ? "Start" : done ? "Done" : "Next →"}</button>
          <button className="btn ghost" onClick={() => setNum(operandOfLen(randInt(2, 4)))}>New number</button>
        </div>
        {cur ? (
          <div className="wp">
            <div className="step-lab">{cur.first ? "rightmost digit" : cur.last ? "leading zero" : `digit ${cur.d}, neighbor ${cur.n}`}</div>
            <div className="calc">
              {cur.terms.map((x, i) => <span className="term" key={i}>{i > 0 && x.value >= 0 ? <span className="o">+</span> : null}<b>{x.value < 0 ? `−${-x.value}` : x.value}</b><i>{x.label}</i></span>)}
              {cur.carryIn > 0 && <span className="term"><span className="o">+</span><b className="r">{cur.carryIn}</b><i>carry</i></span>}
              <span className="o">=</span><span className="tot">{cur.total}</span>
            </div>
            <div className="wd">{cur.last ? <>write <b>{cur.digit}</b> — done</> : cur.carryOut > 0 ? <>write <b>{cur.digit}</b>, carry <b className="r">{cur.carryOut}</b></> : <>write <b>{cur.digit}</b></>}</div>
          </div>
        ) : <div className="wp idle">Press Start to walk it through, right to left.</div>}
        <div className="ansrow"><span className="tag">answer</span>{String(ans).split("").map((c, i, a) => { const fromR = a.length - 1 - i; const rev = step < 0 ? -1 : step >= steps.length - 1 ? a.length - 1 : step;
          return <span key={i} className={"ad" + (fromR <= rev ? " s" : "")}>{fromR <= rev ? c : "·"}</span>; })}{done && step >= 0 && <span className="ck">✓ {ans}</span>}</div>
      </div>
    </main>
  );
}

/* ═══════════ progress ═══════════ */
function Progress({ data, reset }) {
  return (
    <main className="wrap">
      <div className="prog-top"><span>Problems solved: <b>{data.totalProblems}</b></span><span>Unlocked: <b>{data.unlocked.length}/{ORDER.length}</b></span></div>
      <div className="prog-grid">
        {ORDER.map((m) => { const sk = data.skills[m]; const ml = mastery(sk); const open = data.unlocked.includes(m);
          return (
            <div className={"pcard" + (open ? "" : " lock")} key={m}>
              <div className="pc-h"><span className="pc-m">×{m}</span>{open ? <span className="pc-f">{FADE[fadeLevel(sk)]}</span> : <span className="pc-l">locked</span>}</div>
              <div className="pc-bar"><i style={{ width: `${ml * 100}%` }} /></div>
              <div className="pc-stat">{sk.seen ? `${sk.correct}/${sk.seen} · ${Math.round(ml * 100)}% recent` : "not started"}</div>
            </div>
          ); })}
      </div>
      <p className="explainer">A multiplier unlocks the next once it's reliably above 80% over your last few attempts. "Fade" is how much help the Session still gives you on it.</p>
      <button className="btn ghost danger" onClick={() => { if (confirm("Erase all saved progress?")) reset(); }}>Reset all progress</button>
    </main>
  );
}

/* ═══════════ styles ═══════════ */
function Style() {
  return (<style>{`
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;800;900&family=Spectral:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500;700&display=swap');
.tt-root{--paper:#f7f8f4;--grid:rgba(83,114,153,.12);--ink:#1d2b45;--soft:#586a86;--red:#c23a26;--green:#2e7d4f;--line:#cdd5cf;
 min-height:100vh;background:repeating-linear-gradient(0deg,transparent 0 27px,var(--grid) 27px 28px),repeating-linear-gradient(90deg,transparent 0 27px,var(--grid) 27px 28px),var(--paper);
 color:var(--ink);font-family:'Spectral',Georgia,serif;display:flex;flex-direction:column;align-items:center;padding:0 14px 48px;}
.tt-root *{box-sizing:border-box;} .tt-root button{font-family:inherit;cursor:pointer;}
.loading{margin-top:80px;font-family:'IBM Plex Mono',monospace;color:var(--soft);}
.tt-head{width:100%;max-width:880px;border-bottom:3px solid var(--ink);padding:24px 0 12px;}
.hi{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap;}
.eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--soft);}
.tt-head h1{font-family:'Archivo',sans-serif;font-weight:900;font-size:clamp(26px,5vw,40px);margin:2px 0 0;letter-spacing:-.01em;}
.amp{color:var(--red);}
.tabs{display:flex;border:2px solid var(--ink);max-width:100%;overflow-x:auto;}
.tabs button{background:transparent;border:none;padding:8px 14px;font-family:'Archivo',sans-serif;font-weight:800;font-size:13px;color:var(--ink);border-left:1px solid var(--line);}
.tabs button:first-child{border-left:none;} .tabs button.on{background:var(--ink);color:var(--paper);}
:focus-visible{outline:3px solid var(--red);outline-offset:2px;}
.wrap{width:100%;max-width:880px;padding-top:18px;display:flex;flex-direction:column;gap:14px;}
.card{background:#fff;border:2px solid var(--ink);padding:22px;box-shadow:5px 5px 0 rgba(29,43,69,.12);}
.btn{font-family:'Archivo',sans-serif;font-weight:800;font-size:13px;padding:8px 16px;border:2px solid var(--ink);background:#fff;color:var(--ink);}
.btn.primary{background:var(--ink);color:var(--paper);} .btn:disabled{opacity:.38;cursor:default;} .btn.ghost:hover:not(:disabled){background:var(--paper);}
.btn.danger{border-color:var(--red);color:var(--red);align-self:flex-start;}
.tag{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.07em;text-transform:uppercase;border:1px solid var(--line);padding:2px 7px;color:var(--soft);background:var(--paper);}
.sess-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.badge{font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:18px;background:var(--ink);color:var(--paper);padding:3px 10px;}
.fade-pill{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;border:1.5px solid var(--ink);padding:3px 9px;}
.sk-bar{flex:0 0 90px;height:7px;background:var(--line);position:relative;} .sk-bar i{position:absolute;inset:0 auto 0 0;background:var(--green);}
.spacer{flex:1;} .metric{font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--ink);} .metric b{font-size:15px;}
.prob{display:flex;align-items:baseline;gap:14px;margin-bottom:14px;} .prob.lh{align-items:flex-end;}
.pn{font-family:'IBM Plex Mono',monospace;font-size:46px;font-weight:700;} .px{font-family:'IBM Plex Mono',monospace;font-size:28px;font-weight:700;color:var(--red);}
.ruleline{font-size:15px;color:var(--soft);display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;} .ruleline.big{font-size:16px;} .ruleline.sm{font-size:13px;margin-top:12px;}
.cells{display:flex;gap:8px;flex-wrap:wrap;} .cell{width:50px;height:60px;font-family:'IBM Plex Mono',monospace;font-size:28px;font-weight:700;text-align:center;border:2px solid var(--ink);background:var(--paper);color:var(--ink);}
.cell.ok{border-color:var(--green);color:var(--green);background:rgba(46,125,79,.07);} .cell.bad{border-color:var(--red);color:var(--red);background:rgba(194,58,38,.07);}
.note{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--soft);margin-top:7px;}
.acts{display:flex;align-items:center;gap:10px;margin-top:16px;flex-wrap:wrap;}
.verdict{font-family:'Archivo',sans-serif;font-weight:800;font-size:14px;} .verdict.ok{color:var(--green);} .verdict.bad{color:var(--red);}
.diag{margin-top:6px;} .issue{margin:10px 0;font-size:14px;background:var(--paper);border-left:4px solid var(--red);padding:8px 12px;}
.strip{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;} .strip.muted{opacity:.75;}
.scol{border:1px solid var(--line);background:var(--paper);padding:6px 8px;min-width:58px;text-align:center;}
.scol-calc{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--soft);display:flex;gap:2px;justify-content:center;flex-wrap:wrap;} .scol-calc .cy{color:var(--red);}
.scol-eq{font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--soft);border-top:1px solid var(--line);margin-top:3px;padding-top:2px;}
.scol-out{font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:700;} .scol-out sup{color:var(--red);font-size:10px;}
.explainer{font-size:13.5px;color:var(--soft);line-height:1.6;font-style:italic;margin:2px 0 0;} .explainer.top{margin-bottom:4px;}
.menu{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;}
.mcard{text-align:left;border:2px solid var(--ink);background:#fff;padding:18px;box-shadow:4px 4px 0 rgba(29,43,69,.12);}
.mcard:hover{transform:translate(-1px,-1px);box-shadow:6px 6px 0 rgba(29,43,69,.14);}
.mc-x{font-family:'Archivo',sans-serif;font-weight:900;font-size:34px;color:var(--red);line-height:1;}
.mc-t{font-family:'Archivo',sans-serif;font-weight:800;font-size:17px;margin:8px 0 4px;} .mc-d{font-size:13.5px;color:var(--soft);line-height:1.5;}
.back{background:none;border:none;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--soft);align-self:flex-start;padding:0;}
.rapid-head{display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px;} .rapid-head h2{font-family:'Archivo',sans-serif;font-weight:900;margin:0;font-size:24px;}
.rapid-stats{display:flex;gap:14px;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--soft);} .rapid-stats b{color:var(--ink);font-size:15px;}
.hint{font-size:14px;color:var(--soft);font-style:italic;}
.rapid{align-items:center;display:flex;flex-direction:column;gap:16px;transition:background .12s;} .rapid.f-ok{background:rgba(46,125,79,.1);} .rapid.f-bad{background:rgba(194,58,38,.1);}
.rapid-q{font-family:'IBM Plex Mono',monospace;font-size:52px;font-weight:700;}
.rapid-in{width:120px;height:74px;font-family:'IBM Plex Mono',monospace;font-size:40px;font-weight:700;text-align:center;border:2px solid var(--ink);background:var(--paper);color:var(--ink);}
.rapid-choices{display:flex;gap:12px;} .bigbtn{font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:24px;padding:14px 28px;border:2px solid var(--ink);background:var(--paper);color:var(--ink);} .bigbtn:hover{background:#fff;}
.col-q{display:flex;gap:10px;align-items:baseline;font-family:'IBM Plex Mono',monospace;flex-wrap:wrap;justify-content:center;}
.cqx{font-size:30px;font-weight:700;color:var(--red);} .cqd{font-size:22px;font-weight:700;} .cqn{font-size:18px;color:var(--soft);}
.picker{display:flex;gap:6px;flex-wrap:wrap;} .chip{border:1.5px solid var(--ink);background:#fff;font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:15px;padding:5px 11px;color:var(--ink);} .chip.on{background:var(--ink);color:var(--paper);} .chip.lock{opacity:.5;}
.digit-row{display:flex;gap:5px;} .dg{position:relative;font-family:'IBM Plex Mono',monospace;font-size:32px;font-weight:700;width:42px;height:52px;display:flex;align-items:center;justify-content:center;border-bottom:3px solid transparent;}
.dg.pad{color:#b3bcc9;} .dg.hot{background:rgba(194,58,38,.1);border-bottom-color:var(--red);color:var(--red);} .dg.nb{background:rgba(29,43,69,.07);border-bottom-color:var(--ink);}
.dg em{position:absolute;top:-13px;left:50%;transform:translateX(-50%);font-size:9px;font-style:normal;text-transform:uppercase;letter-spacing:.06em;color:var(--red);} .dg em.n{color:var(--soft);}
.wp{margin-top:14px;border-top:1px dashed var(--line);padding-top:12px;min-height:90px;} .wp.idle{color:var(--soft);display:flex;align-items:center;}
.step-lab{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--soft);margin-bottom:8px;}
.calc{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;} .term{display:inline-flex;align-items:baseline;gap:5px;} .term b{font-family:'IBM Plex Mono',monospace;font-size:24px;} .term b.r{color:var(--red);} .term i{font-size:11px;color:var(--soft);font-style:italic;} .term .o,.calc .o{font-family:'IBM Plex Mono',monospace;font-size:20px;color:var(--soft);}
.tot{font-family:'IBM Plex Mono',monospace;font-size:26px;font-weight:700;border-bottom:3px double var(--ink);}
.wd{margin-top:9px;font-size:15px;} .wd b{font-family:'IBM Plex Mono',monospace;} .r{color:var(--red);}
.ansrow{margin-top:14px;border-top:1px dashed var(--line);padding-top:11px;display:flex;align-items:center;gap:9px;flex-wrap:wrap;}
.ad{font-family:'IBM Plex Mono',monospace;font-size:24px;font-weight:700;width:26px;text-align:center;color:#c4ccd6;border-bottom:2px solid var(--line);} .ad.s{color:var(--ink);border-bottom-color:var(--ink);} .ck{font-family:'IBM Plex Mono',monospace;color:var(--green);font-weight:700;font-size:13px;}
.prog-top{display:flex;gap:20px;font-size:14px;flex-wrap:wrap;} .prog-top b{font-family:'IBM Plex Mono',monospace;}
.prog-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;}
.pcard{border:2px solid var(--ink);background:#fff;padding:12px;} .pcard.lock{opacity:.45;border-style:dashed;}
.pc-h{display:flex;justify-content:space-between;align-items:baseline;} .pc-m{font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:20px;}
.pc-f{font-family:'IBM Plex Mono',monospace;font-size:10px;text-transform:uppercase;color:var(--soft);} .pc-l{font-size:10px;color:var(--soft);}
.pc-bar{height:7px;background:var(--line);margin:8px 0 6px;position:relative;} .pc-bar i{position:absolute;inset:0 auto 0 0;background:var(--green);}
.pc-stat{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--soft);}
.tabs button{white-space:nowrap;}
.engine-card .eng-h{display:flex;align-items:baseline;gap:12px;margin-bottom:8px;}
.eng-n{font-family:'Archivo',sans-serif;font-weight:900;font-size:30px;color:var(--red);line-height:1;}
.eng-t{font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--soft);}
.eng-p{font-size:14.5px;line-height:1.62;margin:0 0 10px;} .eng-p.sm{font-size:13px;color:var(--soft);}
.eng-p b{color:var(--ink);} .eng-p i{color:var(--soft);}
.ftable{border-collapse:collapse;font-family:'IBM Plex Mono',monospace;font-size:13px;margin:4px 0 10px;}
.ftable th{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--soft);font-weight:500;padding:4px 12px;border-bottom:2px solid var(--ink);text-align:center;}
.ftable td{padding:3px 12px;text-align:center;border-bottom:1px solid var(--line);}
.ftable .hl{background:rgba(29,43,69,.08);font-weight:700;} .ftable .hl5{background:rgba(194,58,38,.12);color:var(--red);font-weight:700;}
.ftable.mini{font-size:12px;} .ftable.mini td,.ftable.mini th{padding:2px 9px;}
.frame-h{font-family:'Archivo',sans-serif;font-weight:800;font-size:18px;margin-bottom:4px;}
.dtable{border-collapse:collapse;width:100%;font-family:'IBM Plex Mono',monospace;margin-top:8px;}
.dtable th{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--soft);font-weight:500;text-align:left;padding:4px 8px;border-bottom:2px solid var(--ink);}
.drow{cursor:pointer;} .drow td{padding:6px 8px;border-bottom:1px solid var(--line);font-size:14px;} .drow:hover{background:var(--paper);} .drow.on{background:rgba(194,58,38,.07);}
.dm{font-weight:700;font-size:16px;} .deq{color:var(--soft);} .dbase{font-weight:500;} .dbase.ten{color:var(--ink);} .dbase.five{color:var(--red);} .ddig{color:var(--soft);}
.why-body{margin-top:14px;border-top:1px dashed var(--line);padding-top:14px;}
.why-rule{font-size:15px;margin-bottom:12px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;}
.why-block{margin-bottom:14px;} .why-bh{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--red);margin-bottom:4px;}
.why-bp{font-size:14.5px;line-height:1.62;margin:0;}
.why-toggle{background:none;border:none;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--red);text-decoration:underline;padding:0;margin-left:auto;}
.why-inline{padding-top:6px;}
.gotcha{border-color:var(--red);}
.glist{margin:6px 0 0;padding-left:20px;} .glist li{font-size:14.5px;line-height:1.6;margin-bottom:10px;} .glist b{color:var(--red);}
.universal .ulist{margin:6px 0 0;padding-left:20px;} .universal .ulist li{font-size:14.5px;line-height:1.6;margin-bottom:8px;} .universal .ulist b{color:var(--ink);}
.method-num{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:14px;color:var(--soft);}
.method-num input{font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:700;padding:6px 10px;border:2px solid var(--ink);width:110px;background:#fff;color:var(--ink);}
.method-hint{font-family:'IBM Plex Mono',monospace;font-size:11px;}
.mcard-full{padding:18px 20px;}
.mfh{display:flex;align-items:baseline;gap:12px;margin-bottom:12px;flex-wrap:wrap;}
.mfx{font-family:'Archivo',sans-serif;font-weight:900;font-size:26px;color:var(--red);line-height:1;}
.mfs{font-size:15px;font-weight:600;}
.steps3{display:grid;grid-template-columns:1fr;gap:0;border-top:1px solid var(--line);}
.s3{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);align-items:baseline;}
.s3-l{font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--soft);}
.s3-t{font-size:14.5px;line-height:1.5;}
.mfx-ex{display:flex;align-items:center;gap:14px;margin-top:12px;flex-wrap:wrap;}
.ex-line{font-family:'IBM Plex Mono',monospace;font-size:16px;} .ex-line b{font-size:18px;}
.wt{margin-top:12px;border-top:1px dashed var(--line);padding-top:10px;display:flex;flex-direction:column;gap:5px;}
.wt-row{display:grid;grid-template-columns:70px 1fr auto;gap:10px;align-items:baseline;font-family:'IBM Plex Mono',monospace;font-size:13px;}
.wt-pos{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--soft);}
.wt-calc{color:var(--ink);} .wt-calc i{font-style:normal;font-size:9.5px;color:var(--soft);margin-left:2px;} .wt-eq{color:var(--soft);}
.wt-out{font-weight:700;font-size:16px;} .wt-out em{font-style:normal;color:var(--red);font-size:11px;}
@media(max-width:520px){.s3{grid-template-columns:1fr;gap:2px;} .wt-row{grid-template-columns:54px 1fr auto;font-size:12px;}}
@media(prefers-reduced-motion:reduce){.tt-root *{transition:none!important;} .mcard:hover{transform:none;}}
@media(max-width:520px){.cell{width:42px;height:52px;font-size:23px;} .pn{font-size:36px;} .rapid-q{font-size:42px;} .dg{width:34px;height:44px;font-size:25px;}}
`}</style>);
}
