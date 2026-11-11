// 더치페이 계산 엔진 — PC 판 models.py 와 같은 규칙(정수 '원' 단위, 1원 오차 없음).
// 화면과 무관한 순수 계산이라 브라우저와 Node(테스트) 양쪽에서 그대로 쓴다.
//
// 나머지 처리: 금액을 n 명이 나누면 1인당 floor(금액/n) 원, 남는 r 원(r < n)은
//   결제자가 나눠 내는 사람에 있으면 결제자가 r 원을 더 내고,
//   없으면(대신 결제) 나눠 내는 사람 앞에서부터(참석자 순서) 1 원씩 더 낸다.
// 송금 경로: 받을 사람·보낼 사람을 큰 금액부터 맞춘다(송금 횟수 ≤ 차액 0 아닌 인원 − 1).
// 모임 통장(fundMode): 잔액(fund)이나 1인 참가비(fee)가 있으면 켜짐, 총무(treasurerId) 필수.
//   통장 = 잔액 + 참가비×인원. 지출은 전부 통장이 부담(개인이 대신 낸 돈은 총무가 돌려줌, 총무 결제 = 통장에서).
//   모자라면 인원수로 똑같이 더 내고 남는 원은 총무가. 남으면 carry=다음 모임 잔액 / refund=똑같이 돌려주고 남는 원은 이월.
//   각자의 몫(owed) = 참가비 + 더 낼 돈 − 돌려받을 돈. 송금은 모두 총무를 거친다.

export const MAX_AMOUNT = 1e12;
export const APP_URL = "https://unibunny-official.github.io/1won/";   // 공유 글 끝에 붙인다

export class DutchPayError extends Error {}

export function won(v) {
  return `${Math.trunc(v).toLocaleString("en-US")}원`;
}

/** '12,000' / '12000원' / 12000 → 12000. 0 이하·원 단위 미만·쉼표 오타는 거절. */
export function parseAmount(text) {
  let s = String(text).trim();
  if (s.endsWith("원")) s = s.slice(0, -1).trim();
  if (s.includes(",")) {
    if (!/^\d{1,3}(,\d{3})+$/.test(s)) throw new DutchPayError(`금액의 쉼표 위치를 확인해 주세요: '${text}'`);
    s = s.replaceAll(",", "");
  }
  if (!/^(\d+(\.\d+)?|\d+(\.\d+)?[eE][+-]?\d+)$/.test(s)) throw new DutchPayError(`금액을 숫자로 적어 주세요: '${text}'`);
  const v = Number(s);
  if (!Number.isFinite(v) || v <= 0) throw new DutchPayError("금액은 0원보다 커야 해요.");
  if (v >= MAX_AMOUNT) throw new DutchPayError("금액이 너무 커요(1조 원 미만).");
  if (!Number.isInteger(v)) throw new DutchPayError("금액은 원 단위(소수점 없이)로 적어 주세요.");
  return v;
}

/** parseAmount 와 같되 빈칸·0 은 0원(모임 잔액·참가비처럼 없어도 되는 칸). */
export function parseAmount0(text) {
  let s = String(text ?? "").trim();
  if (s.endsWith("원")) s = s.slice(0, -1).trim();
  if (!s || /^0+$/.test(s)) return 0;
  return parseAmount(text);
}

export const SURPLUS_MODES = ["carry", "refund"];   // 남는 돈: 다음 모임 잔액으로 / 똑같이 돌려주기

/** '' 또는 실제 있는 날짜 'yyyy-MM-dd' 만 받는다. */
export function checkDate(text) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || +m[1] < 1) {
    throw new DutchPayError(`날짜는 2026-11-10 처럼 적어 주세요: '${t}'`);
  }
  return t;
}

function safeDate(t) {
  try { return checkDate(t); } catch { return ""; }
}

export class Event {
  constructor({ date = "", title = "", endDate = "" } = {}) {
    this.date = date;         // 모임 시작 날짜
    this.endDate = endDate;   // 끝 날짜. 비었거나 시작과 같으면 하루짜리 모임
    this.title = title;
    this.participants = [];   // {id, name}
    this.expenses = [];       // {id, item_name, amount, payer_id, shared_by, date}
    this.treasurerId = null;  // 총무(모임 통장을 가진 사람)
    this.fund = 0;            // 모임 잔액(시작할 때 통장에 있던 돈)
    this.fee = 0;             // 1인 참가비
    this.surplus = "carry";   // 남는 돈: carry(다음 모임 잔액) / refund(똑같이 돌려주기)
    this.nextPid = 1;
    this.nextEid = 1;
  }

  // ----- 모임 통장 -----
  get fundMode() { return this.fund > 0 || this.fee > 0; }

  setTreasurer(pid) {
    if (pid === null || pid === undefined) {
      if (this.fundMode) throw new DutchPayError("모임 잔액이나 참가비가 있으면 총무가 필요해요. 다른 사람을 총무로 정해 주세요.");
      this.treasurerId = null;
      return;
    }
    this.participant(pid);
    this.treasurerId = pid;
  }

  /** 모임 잔액·1인 참가비·남는 돈 처리 방식을 한 번에. 잘못되면 아무것도 바꾸지 않는다. */
  setFund(fund, fee, surplus = "carry") {
    const fundV = parseAmount0(fund), feeV = parseAmount0(fee);
    if (!SURPLUS_MODES.includes(surplus)) throw new DutchPayError(`남는 돈 처리 방식이 이상해요: '${surplus}'`);
    if ((fundV > 0 || feeV > 0) && (this.treasurerId === null || !this.participants.some((p) => p.id === this.treasurerId))) {
      throw new DutchPayError("모임 잔액·참가비를 쓰려면 총무가 필요해요. 이름을 누르고 '총무로'를 눌러 주세요.");
    }
    this.fund = fundV; this.fee = feeV; this.surplus = surplus;
  }

  /** 같은 모임의 다음 정산: 사람·총무·참가비·남는 돈 방식·이름을 가져오고 잔액은 '다음 모임 잔액'으로. 지출은 비움. */
  nextEvent(date) {
    const ev = new Event({ date: checkDate(date), title: this.title });
    ev.participants = this.participants.map((p) => ({ id: p.id, name: p.name }));
    ev.nextPid = this.nextPid;
    ev.treasurerId = this.treasurerId;
    ev.fee = this.fee; ev.surplus = this.surplus;
    ev.fund = this.fundMode ? this.fundSummary().nextFund : this.fund;
    return ev;
  }

  /** {n, pool, total, short, extra, rem, refund, nextFund} — PC 판 fund_summary 와 같다. */
  fundSummary() {
    const n = this.participants.length;
    const pool = this.fund + this.fee * n;
    const total = this.total();
    let short = 0, extra = 0, rem = 0, refund = 0, nextFund;
    if (total > pool) {
      short = total - pool;
      if (n) { extra = Math.floor(short / n); rem = short - extra * n; }
      nextFund = 0;
    } else {
      const left = pool - total;
      if (this.surplus === "refund" && n) { refund = Math.floor(left / n); nextFund = left - refund * n; }
      else nextFund = left;
    }
    return { n, pool, total, short, extra, rem, refund, nextFund };
  }

  // ----- 참석자 -----
  participant(pid) {
    const p = this.participants.find((x) => x.id === pid);
    if (!p) throw new DutchPayError(`없는 참석자예요: ${pid}`);
    return p;
  }

  checkName(name, exceptId = null) {
    name = String(name ?? "").trim();
    if (!name) throw new DutchPayError("이름을 적어 주세요.");
    if (this.participants.some((p) => p.name === name && p.id !== exceptId)) {
      throw new DutchPayError(`'${name}' 은(는) 이미 있어요.`);
    }
    return name;
  }

  addParticipant(name) {
    const p = { id: this.nextPid++, name: this.checkName(name) };
    this.participants.push(p);
    return p;
  }

  renameParticipant(pid, name) {
    this.participant(pid).name = this.checkName(name, pid);
  }

  /** 뺄 수 없으면 이유를 담아 DutchPayError. (화면에서 '뺄까요?' 묻기 전에 먼저 확인) */
  checkRemovable(pid) {
    const p = this.participant(pid);
    if (pid === this.treasurerId && this.fundMode) {
      throw new DutchPayError(`${p.name} 님은 총무예요. 먼저 다른 사람을 총무로 정해 주세요.`);
    }
    const paid = this.expenses.filter((e) => e.payer_id === pid).map((e) => e.item_name);
    if (paid.length) {
      throw new DutchPayError(`${p.name} 님이 결제한 항목이 있어요(${paid.join(", ")}). 그 항목의 결제자를 먼저 바꾸거나 지워 주세요.`);
    }
    const alone = this.expenses.filter((e) => e.shared_by.length === 1 && e.shared_by[0] === pid).map((e) => e.item_name);
    if (alone.length) {
      throw new DutchPayError(`${p.name} 님 혼자 나눠 내는 항목이 있어요(${alone.join(", ")}). 그 항목을 먼저 고쳐 주세요.`);
    }
  }

  /** 결제자로 남아 있거나 혼자 부담하는 항목이 있으면 거절, 나눠 내는 사람에서는 빠진다. */
  removeParticipant(pid) {
    this.checkRemovable(pid);
    for (const e of this.expenses) e.shared_by = e.shared_by.filter((x) => x !== pid);
    this.participants = this.participants.filter((x) => x.id !== pid);
    if (pid === this.treasurerId) this.treasurerId = null;
  }

  // ----- 지출 -----
  expense(eid) {
    const e = this.expenses.find((x) => x.id === eid);
    if (!e) throw new DutchPayError(`없는 지출 항목이에요: ${eid}`);
    return e;
  }

  checkExpense(itemName, amount, payerId, sharedBy) {
    itemName = String(itemName ?? "").trim();
    if (!itemName) throw new DutchPayError("무엇에 쓴 돈인지 적어 주세요.");
    amount = parseAmount(amount);
    this.participant(payerId);
    if (!sharedBy || !sharedBy.length) throw new DutchPayError("나눠 낼 사람을 한 명 이상 골라 주세요.");
    for (const pid of sharedBy) this.participant(pid);
    const order = this.participants.map((p) => p.id);
    const shared = [...new Set(sharedBy)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return [itemName, amount, shared];
  }

  addExpense(itemName, amount, payerId, sharedBy, date = "") {
    const [name, amt, shared] = this.checkExpense(itemName, amount, payerId, sharedBy);
    const e = { id: this.nextEid++, item_name: name, amount: amt, payer_id: payerId, shared_by: shared,
                date: checkDate(date) || this.date };
    this.expenses.push(e);
    return e;
  }

  /** date 를 주지 않으면(null) 원래 날짜를 그대로 둔다. */
  updateExpense(eid, itemName, amount, payerId, sharedBy, date = null) {
    const e = this.expense(eid);
    const newDate = date === null ? e.date : (checkDate(date) || this.date);
    const [name, amt, shared] = this.checkExpense(itemName, amount, payerId, sharedBy);
    Object.assign(e, { item_name: name, amount: amt, payer_id: payerId, shared_by: shared, date: newDate });
  }

  removeExpense(eid) {
    this.expense(eid);
    this.expenses = this.expenses.filter((x) => x.id !== eid);
  }

  expensesByDate() {
    return [...this.expenses].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  }

  // ----- 계산 -----
  split(e) {
    const n = e.shared_by.length;
    const base = Math.floor(e.amount / n);
    const shares = new Map(e.shared_by.map((pid) => [pid, base]));
    const rest = e.amount - base * n;
    if (rest) {
      if (shares.has(e.payer_id)) shares.set(e.payer_id, shares.get(e.payer_id) + rest);
      else for (const pid of e.shared_by.slice(0, rest)) shares.set(pid, shares.get(pid) + 1);
    }
    return shares;
  }

  balances() {
    const out = new Map(this.participants.map((p) => [p.id, { paid: 0, owed: 0, net: 0 }]));
    for (const e of this.expenses) out.get(e.payer_id).paid += e.amount;
    if (this.fundMode) {
      const fs = this.fundSummary();
      for (const [pid, b] of out) b.owed = this.fee + fs.extra + (pid === this.treasurerId ? fs.rem : 0) - fs.refund;
    } else {
      for (const e of this.expenses) for (const [pid, share] of this.split(e)) out.get(pid).owed += share;
    }
    for (const b of out.values()) b.net = b.paid - b.owed;
    return out;
  }

  total() {
    return this.expenses.reduce((s, e) => s + e.amount, 0);
  }

  /** 누가 누구에게 얼마 보낼지 [{from, to, amount}]. 큰 금액끼리 먼저(참석자 순서로 동률 정리). */
  settle() {
    const nets = new Map([...this.balances()].map(([pid, b]) => [pid, b.net]));
    if (this.fundMode) {              // 모두 총무를 거친다: 각자 → 총무(몫 − 대신 낸 돈), 음수면 총무 → 각자
      const t = this.treasurerId, out = [];
      for (const p of this.participants) {
        const v = nets.get(p.id);
        if (p.id === t || v === 0) continue;
        out.push(v < 0 ? { from: p.id, to: t, amount: -v } : { from: t, to: p.id, amount: v });
      }
      return out;
    }
    const order = new Map(this.participants.map((p, i) => [p.id, i]));
    const cred = [...nets].filter(([, v]) => v > 0).map(([pid]) => pid)
      .sort((a, b) => nets.get(b) - nets.get(a) || order.get(a) - order.get(b));
    const debt = [...nets].filter(([, v]) => v < 0).map(([pid]) => pid)
      .sort((a, b) => nets.get(a) - nets.get(b) || order.get(a) - order.get(b));
    const left = new Map(nets);
    const out = [];
    let i = 0, j = 0;
    while (i < cred.length && j < debt.length) {
      const c = cred[i], d = debt[j];
      const amt = Math.min(left.get(c), -left.get(d));
      out.push({ from: d, to: c, amount: amt });
      left.set(c, left.get(c) - amt);
      left.set(d, left.get(d) + amt);
      if (left.get(c) === 0) i++;
      if (left.get(d) === 0) j++;
    }
    return out;
  }

  /** '2026-11-07' 또는 '2026-11-07 ~ 11-09' (해가 바뀌면 '2026-12-31 ~ 2027-01-02'). */
  dateRange() {
    const end = this.endDate;
    if (!this.date || !end || end <= this.date) return this.date;
    return `${this.date} ~ ${end.slice(0, 4) === this.date.slice(0, 4) ? end.slice(5) : end}`;
  }

  /** 메신저에 붙여 넣을 정산 안내 글(PC 판과 같은 모양). */
  summaryText() {
    const name = new Map(this.participants.map((p) => [p.id, p.name]));
    const head = [this.dateRange(), this.title].filter(Boolean).join(" ") || "더치페이";
    const lines = [`🍰 ${head} 정산`, `총 ${won(this.total())} · ${this.participants.length}명`, ""];
    if (this.fundMode) {
      const fs = this.fundSummary();
      const tname = name.get(this.treasurerId) ?? "총무";
      const parts = [`잔액 ${won(this.fund)}`, ...(this.fee ? [`참가비 ${won(this.fee)}×${fs.n}명`] : [])];
      lines.push(`💰 모임 통장(총무 ${tname}): ${parts.join(" + ")} = ${won(fs.pool)}`);
      if (fs.short) lines.push(`   ${won(fs.short)} 모자라서 1인 ${won(fs.extra)}씩 더 내요` + (fs.rem ? `(남는 ${won(fs.rem)}은 총무가)` : ""));
      else if (fs.refund) lines.push(`   ${won(fs.pool - fs.total)} 남아서 1인 ${won(fs.refund)}씩 돌려받아요` + (fs.nextFund ? `(${won(fs.nextFund)}은 다음 모임으로)` : ""));
      lines.push(`   📌 다음 모임 잔액 ${won(fs.nextFund)}`, "");
    }
    const manyDays = new Set(this.expenses.map((e) => e.date)).size > 1;
    for (const e of this.expensesByDate()) {
      const day = manyDays && e.date ? `${e.date.slice(5).replace("-", "/")} ` : "";
      lines.push(`· ${day}${e.item_name} ${won(e.amount)} (${name.get(e.payer_id)} 결제)`);
    }
    lines.push("");
    const transfers = this.settle();
    if (transfers.length) {
      lines.push("💸 보낼 돈");
      for (const t of transfers) lines.push(`  ${name.get(t.from)} → ${name.get(t.to)}  ${won(t.amount)}`);
    } else {
      lines.push("주고받을 돈이 없어요 🎉");
    }
    lines.push("", `🍰 1원 더치페이 · ${APP_URL}`);      // 받은 사람이 다음 모임에서 쓰게
    return lines.join("\n");
  }

  // ----- 저장(PC 판 .dpay.json 과 같은 형식) -----
  toDict() {
    const d = {
      date: this.date, end_date: this.endDate, title: this.title,
      participants: this.participants.map((p) => ({ id: p.id, name: p.name })),
      expenses: this.expenses.map((e) => ({ id: e.id, date: e.date, item_name: e.item_name, amount: String(e.amount),
                                            payer_id: e.payer_id, shared_by: [...e.shared_by] })),
    };
    if (this.treasurerId !== null || this.fundMode || this.surplus !== "carry") {
      d.treasurer_id = this.treasurerId; d.fund = String(this.fund); d.fee = String(this.fee); d.surplus = this.surplus;
    }
    return d;
  }

  /** 저장 파일 복원. 입력할 때와 같은 검사를 거친다. */
  static fromDict(d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new DutchPayError("저장 파일 형식이 맞지 않아요.");
    if ((d.participants?.length ?? 0) > 200 || (d.expenses?.length ?? 0) > 5000) {
      throw new DutchPayError("사람(200명)이나 지출(5,000건)이 너무 많은 파일이에요.");
    }
    try {
      const ev = new Event({ date: String(d.date ?? ""), title: String(d.title ?? "") });
      // 끝 날짜(예전 파일엔 없음): 이상하거나 시작보다 빠르면 하루짜리로
      const end = safeDate(String(d.end_date ?? ""));
      ev.endDate = end && safeDate(ev.date) && end > ev.date ? end : "";
      for (const p of d.participants ?? []) {
        const pid = parseInt(p.id, 10);
        if (!(pid > 0) || ev.participants.some((q) => q.id === pid)) throw new DutchPayError(`참석자 번호가 잘못됐어요: ${p.id}`);
        const pname = String(p.name ?? "");
        if (pname.length > 40) throw new DutchPayError("이름이 너무 길어요(40자까지).");
        ev.participants.push({ id: pid, name: ev.checkName(pname) });
      }
      for (const e of d.expenses ?? []) {
        const eid = parseInt(e.id, 10);
        if (!(eid > 0) || ev.expenses.some((x) => x.id === eid)) throw new DutchPayError(`지출 번호가 잘못됐어요: ${e.id}`);
        const payer = parseInt(e.payer_id, 10);
        if (String(e.item_name ?? "").length > 80) throw new DutchPayError("항목 이름이 너무 길어요(80자까지).");
        const [name, amount, shared] = ev.checkExpense(String(e.item_name ?? ""), e.amount, payer,
                                                       (e.shared_by ?? []).map((x) => parseInt(x, 10)));
        const day = checkDate(String(e.date ?? "")) || safeDate(ev.date);
        ev.expenses.push({ id: eid, item_name: name, amount, payer_id: payer, shared_by: shared, date: day });
      }
      if (d.treasurer_id !== null && d.treasurer_id !== undefined) ev.setTreasurer(parseInt(d.treasurer_id, 10));   // 예전 파일엔 없음
      ev.setFund(d.fund ?? 0, d.fee ?? 0, String(d.surplus ?? "carry"));
      ev.nextPid = ev.participants.reduce((m, p) => Math.max(m, p.id), 0) + 1;
      ev.nextEid = ev.expenses.reduce((m, e) => Math.max(m, e.id), 0) + 1;
      return ev;
    } catch (exc) {
      if (exc instanceof DutchPayError) throw exc;
      throw new DutchPayError(`저장 파일 형식이 맞지 않아요: ${exc.message}`);
    }
  }
}
