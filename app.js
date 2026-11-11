// 1원 더치페이 — 휴대폰 웹앱 화면. 계산은 전부 engine.js(PC 판과 같은 규칙).
import { Event, DutchPayError, won, checkDate, APP_URL } from "./engine.js";

export const APP_VERSION = "2.1";
const ANIMALS = [..."🐰🐻🐱🐶🐼🦊🐨🐯🐹🐸🐧🐥"];
const STORE_KEY = "dpay.v1";
const $ = (id) => document.getElementById(id);

// ---------------- 저장(이 브라우저 안) ----------------
const params = new URLSearchParams(location.search);
const DEMO = params.has("demo");   // ?demo=1 — 예시 정산(저장하지 않음)

function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.events && typeof s.events === "object") {
      for (const [k, v] of Object.entries(s.events)) if (!v || typeof v !== "object" || !v.data) delete s.events[k];
      return s;
    }
  } catch { /* 깨졌거나 막혀 있으면 새로 */ }
  return { current: null, events: {} };
}
/** 저장소를 '다시 읽고' 바꾼 뒤 쓴다 — 다른 탭·홈 화면 앱이 그사이 바꾼 정산을 덮어쓰지 않게. */
function commit(mutate) {
  if (DEMO) { mutate(store); return; }
  const s = loadStore();
  mutate(s);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }
  catch { toast("이 브라우저에 저장하지 못했어요. 파일로 내보내 두세요."); }
  store = s;
}
let store = DEMO ? { current: null, events: {} } : loadStore();
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

let ev, curId;            // 지금 정산
let editingId = null;     // 고치는 중인 지출
let formDate = "";        // 쓴 돈 날짜(한 번 바꾸면 다음 항목도 유지)
let formDateBefore = "";  // 고치기 들어가기 전 날짜(고치기를 끝내면 되돌림)
let checked = new Set();  // 나눠 낼 사람
let tab = "people";

const validDate = (d) => { try { return checkDate(d); } catch { return ""; } };

function openEvent(id) {
  if (!DEMO) store = loadStore();
  const rec = store.events[id];
  if (!rec) return false;
  try {
    ev = Event.fromDict(rec.data);
  } catch (e) {
    toast(`열지 못했어요: ${e.message}`);
    return false;
  }
  if (!validDate(ev.date)) ev.date = today();   // 날짜가 이상한 파일이면 오늘로(지출 입력이 막히지 않게)
  curId = id;
  commit((s) => { s.current = id; });
  editingId = null;
  formDate = ev.date;
  checked = new Set(ev.participants.map((p) => p.id));
  return true;
}
const isBlank = (e) => !e.participants.length && !e.expenses.length && !e.title;
/** 아무것도 안 넣은 지금 정산은 목록에 남기지 않는다(새로 시작·가져오기 전에). */
function dropIfBlank() {
  if (ev && curId && isBlank(ev)) commit((s) => { delete s.events[curId]; });
}
function addAndOpen(e) {
  dropIfBlank();
  const id = newId();
  commit((s) => { s.events[id] = { saved_at: new Date().toISOString(), data: e.toDict() }; });
  openEvent(id);
}
function startNew() { addAndOpen(new Event({ date: today() })); }
function save() {
  commit((s) => { s.events[curId] = { saved_at: new Date().toISOString(), data: ev.toDict() }; s.current = curId; });
}

// ---------------- 공통 ----------------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const avatar = (pid) => ANIMALS[(pid - 1) % ANIMALS.length];
const label = (pid) => `${pid === ev.treasurerId ? "👑 " : ""}${avatar(pid)} ${ev.participant(pid).name}`;
const fmtWon = (v) => (v ? Number(v).toLocaleString("en-US") : "");
function dayText(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || "");
  if (!m) return day || "-";
  const w = "일월화수목금토"[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return `${+m[2]}/${+m[3]} (${w})`;
}
function netText(net) {
  if (net > 0) return ["get", `받을 돈 ${won(net)}`];
  if (net < 0) return ["give", `보낼 돈 ${won(-net)}`];
  return ["even", "딱 맞아요"];
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/** 아래에서 올라오는 창. buttons: [{text, cls, onClick}] — onClick 이 false 를 돌려주면 안 닫힘. */
function sheet(html, buttons, { top = false } = {}) {
  const m = $("modal"), s = $("sheet");
  m.classList.toggle("top", top);
  s.innerHTML = html + '<div class="actions"></div>';
  const row = s.querySelector(".actions");
  for (const b of buttons) {
    const el = document.createElement("button");
    el.className = `btn ${b.cls || ""}`;
    el.textContent = b.text;
    el.onclick = async () => { if ((await b.onClick?.()) !== false) closeSheet(); };
    row.append(el);
  }
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m) closeSheet(); };
  return s;
}
function closeSheet() { $("modal").hidden = true; $("sheet").innerHTML = ""; }
function confirmSheet(title, text, okText, onOk) {
  sheet(`<h3>${esc(title)}</h3><p>${esc(text)}</p>`,
        [{ text: "취소", cls: "ghost" }, { text: okText, onClick: onOk }]);
}

// ---------------- 화면 그리기 ----------------
function setTab(name) {
  tab = name;
  for (const v of document.querySelectorAll(".view")) v.classList.toggle("on", v.dataset.view === name);
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("on", b.dataset.tab === name);
  window.scrollTo({ top: 0 });
}

function render() {
  // 모임
  $("evDate").value = ev.date;
  $("evEnd").value = ev.endDate || ev.date;
  $("evEnd").min = ev.date;
  if (document.activeElement !== $("evTitle")) $("evTitle").value = ev.title;
  const fm = ev.fundMode;
  if (document.activeElement !== $("fund")) $("fund").value = fmtWon(ev.fund);
  if (document.activeElement !== $("fee")) $("fee").value = fmtWon(ev.fee);
  $("surplus").value = ev.surplus;
  // 사람
  $("people").innerHTML = ev.participants.length
    ? ev.participants.map((p) => `<button class="chip" data-pid="${p.id}">${esc(label(p.id))}</button>`).join("")
    : '<div class="empty">아직 아무도 없어요. 이름을 넣어 주세요 🙂</div>';
  // 쓴 돈 입력
  $("exDate").value = formDate;
  const payer = +$("exPayer").value || null;
  $("exPayer").innerHTML = ev.participants
    .map((p) => `<option value="${p.id}">${esc(label(p.id))}${fm && p.id === ev.treasurerId ? " (통장)" : ""}</option>`).join("");
  if (payer && ev.participants.some((p) => p.id === payer)) $("exPayer").value = String(payer);
  $("sharers").innerHTML = ev.participants
    .map((p) => `<button type="button" class="chip${checked.has(p.id) ? " on" : ""}" data-pid="${p.id}">${esc(label(p.id))}</button>`).join("");
  $("shareBox").hidden = fm;                 // 회비 모임은 모두 같이 → 고를 것 없음
  $("fundShareHint").hidden = !fm;
  const editing = editingId !== null;
  $("formTitle").textContent = editing ? "✏️ 고치는 중" : "🧾 쓴 돈 넣기";
  $("submitBtn").textContent = editing ? "✔ 고친 내용 저장" : "＋ 쓴 돈 넣기";
  $("cancelBtn").hidden = $("deleteBtn").hidden = !editing;
  // 결제 내역(날짜별)
  const list = ev.expensesByDate();
  const days = new Set(list.map((e) => e.date)).size;
  $("listInfo").textContent = `${list.length}건 · 합계 ${won(ev.total())}${days > 1 ? ` · ${days}일` : ""}`;
  let html = "", lastDay = null;
  for (const e of list) {
    if (e.date !== lastDay) { html += `<div class="day">${esc(dayText(e.date))}</div>`; lastDay = e.date; }
    const who = fm || e.shared_by.length === ev.participants.length ? "모두" : e.shared_by.map((p) => label(p)).join(" ");
    html += `<div class="ex${e.id === editingId ? " sel" : ""}" data-eid="${e.id}">
      <span class="name">${esc(e.item_name)}</span><span class="amt">${won(e.amount)}</span>
      <span class="meta">${esc(label(e.payer_id))} 결제 · ${esc(who)}</span></div>`;
  }
  $("expenses").innerHTML = html || '<div class="empty">쓴 돈을 넣으면 여기에 쭉 나와요 ✨</div>';
  // 정산
  const n = ev.participants.length, total = ev.total();
  $("total").textContent = `총 ${won(total)}`;
  $("perInfo").textContent = `${n}명 · 지출 ${list.length}건${n ? ` · 1인 평균 약 ${won(Math.floor(total / n))}` : ""}`;
  $("fundInfo").hidden = !fm;
  if (fm) $("fundInfo").textContent = fundLines().join("\n");
  const bal = ev.balances();
  $("balances").innerHTML = ev.participants.map((p) => {
    const b = bal.get(p.id), isT = fm && p.id === ev.treasurerId;
    const [cls, text] = isT ? ["even", "통장 관리"] : netText(b.net);
    return `<div class="bal"><span class="who">${esc(label(p.id))}</span><span class="net ${cls}">${text}</span>
      <span class="meta">${isT ? "통장에서 낸 돈" : "낸 돈"} ${won(b.paid)} · 내 몫 ${won(b.owed)}</span></div>`;
  }).join("");
  $("balHint").textContent = fm ? "쓴 돈은 통장이 내고, 모자라면 똑같이 더 내요. 나누고 남는 1원 단위는 총무가 더 내요."
    : "나누어떨어지지 않는 1원 단위는 결제한 사람이 더 내요(합계는 1원도 안 틀려요).";
  const tr = ev.settle();
  $("transfers").innerHTML = tr.length
    ? tr.map((t) => `<div class="tr"><span>${esc(label(t.from))} → ${esc(label(t.to))}</span><b>${won(t.amount)}</b></div>`).join("")
    : `<div class="empty">${list.length ? "주고받을 돈이 없어요 🎉" : "쓴 돈을 넣으면 여기에 정산 결과가 나와요 ✨"}</div>`;
  $("shareImg").disabled = $("shareText").disabled = !list.length;
  // 목록
  const recs = Object.entries(store.events).map(([id, r]) => {
    let info;
    try { const e = Event.fromDict(r.data); info = { date: e.date, range: e.dateRange(), title: e.title, n: e.participants.length, total: e.total() }; }
    catch { info = null; }
    return { id, r, info };
  }).sort((a, b) => ((b.info?.date || "") + b.r.saved_at).localeCompare((a.info?.date || "") + a.r.saved_at));
  $("library").innerHTML = recs.map(({ id, info }) => `
    <div class="lib${id === curId ? " cur" : ""}" data-id="${esc(id)}">
      <div class="t">${info ? `<b>${esc(info.title || "이름 없는 정산")}</b>
        <span>📅 ${esc(info.range)} · ${info.n}명 · ${won(info.total)}${id === curId ? " · 지금 여는 중" : ""}</span>`
        : "<b>⚠️ 열 수 없는 정산</b>"}</div>
      <button class="del" data-del="${esc(id)}" aria-label="지우기">🗑️</button></div>`).join("");
  const all = ev.participants.length > 0 && ev.participants.every((p) => checked.has(p.id));
  $("allBtn").textContent = all ? "모두 빼기" : "모두 같이";
  $("ver").textContent = `Ver.${APP_VERSION}`;
}

/** 모임 통장 셈 — 정산 탭·정산표 그림에 같은 글로. */
function fundLines() {
  const fs = ev.fundSummary(), n = ev.participants.length;
  const tname = ev.treasurerId !== null ? ev.participant(ev.treasurerId).name : "총무";
  const parts = [`잔액 ${won(ev.fund)}`, ...(ev.fee ? [`참가비 ${won(ev.fee)}×${n}명`] : [])];
  const out = [`💰 모임 통장(총무 ${tname})`, `${parts.join(" + ")} = ${won(fs.pool)}`];
  if (fs.short) out.push(`${won(fs.short)} 모자라서 1인 ${won(fs.extra)}씩 더 내요` + (fs.rem ? `(남는 ${won(fs.rem)}은 총무가)` : ""));
  else if (fs.refund) out.push(`${won(fs.pool - fs.total)} 남아서 1인 ${won(fs.refund)}씩 돌려받아요` + (fs.nextFund ? `(${won(fs.nextFund)}은 다음 모임으로)` : ""));
  out.push(`📌 다음 모임 잔액 ${won(fs.nextFund)}`);
  return out;
}

// ---------------- 동작 ----------------
function guard(fn) {
  try { fn(); return true; }
  catch (e) {
    if (e instanceof DutchPayError) { toast(e.message); return false; }
    throw e;
  }
}
function changed() { save(); render(); }

function applyFund() {
  const before = [ev.fund, ev.fee, ev.surplus].join();
  if (!guard(() => ev.setFund($("fund").value, $("fee").value, $("surplus").value))) { render(); return; }
  if ([ev.fund, ev.fee, ev.surplus].join() !== before) changed();
}

/** 새 정산. 회비 모임이면 사람·총무·참가비·잔액(다음 모임 잔액)을 가져올지 묻는다. */
function newEvent() {
  const go = (e) => { if (e) addAndOpen(e); else startNew(); render(); setTab("people"); toast("새 정산을 시작했어요 🌱"); };
  if (!ev.fundMode) { go(); return; }
  const cur = ev, next = cur.fundSummary().nextFund;
  sheet(`<h3>🌱 이어서 새 정산</h3><p>'${esc(cur.title || cur.date)}' 모임을 이어서 시작할까요?
    사람·총무·참가비·남는 돈 처리 방식을 가져오고, 모임 잔액은 다음 모임 잔액 <b>${won(next)}</b>으로 시작해요.</p>`, [
    { text: "빈 정산으로", cls: "ghost", onClick: () => go() },
    { text: "이어서 시작", onClick: () => go(cur.nextEvent(today())) },
  ]);
}

function clearForm() {
  if (editingId !== null) formDate = formDateBefore;   // 고치기를 끝내면(저장·취소) 원래 날짜로
  editingId = null;
  $("exItem").value = "";
  $("exAmount").value = "";
  checked = new Set(ev.participants.map((p) => p.id));
}

function submitExpense() {
  const payer = +$("exPayer").value;
  if (!payer) { toast("먼저 함께한 사람을 넣어 주세요."); return; }
  const shared = ev.participants.map((p) => p.id).filter((id) => ev.fundMode || checked.has(id));
  const args = [$("exItem").value, $("exAmount").value, payer, shared, formDate];
  const wasEditing = editingId !== null;
  if (!guard(() => (wasEditing ? ev.updateExpense(editingId, ...args) : ev.addExpense(...args)))) return;
  clearForm();
  changed();
  toast(wasEditing ? "고쳤어요 ✨" : "쏙! 넣었어요 🎈");
  if (!IS_MOBILE) $("exItem").focus();   // 휴대폰은 키보드가 다시 떠서 내역을 가리므로 안 함
}

function editExpense(eid) {
  const e = ev.expense(eid);
  if (editingId === null) formDateBefore = formDate;
  editingId = eid;
  formDate = e.date || formDate;
  $("exItem").value = e.item_name;
  $("exAmount").value = e.amount.toLocaleString("en-US");
  $("exPayer").value = String(e.payer_id);
  checked = new Set(e.shared_by);
  render();
  $("formCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function personSheet(pid) {
  const p = ev.participant(pid);
  const rename = () => guard(() => { ev.renameParticipant(pid, $("renameInput").value); changed(); });
  const isT = pid === ev.treasurerId;
  const s = sheet(`<h3>${esc(label(pid))}</h3>
    <label class="row"><span>새 이름</span><input id="renameInput" maxlength="20" value="${esc(p.name)}" enterkeyhint="done"></label>
    <p class="hint">👑 총무: 모임 통장(잔액·참가비)을 가진 사람. 송금은 모두 총무를 거쳐요.</p>`, [
    { text: "빼기", cls: "ghost danger", onClick: () => { removePerson(pid); } },
    { text: isT ? "👑 총무 해제" : "👑 총무로", cls: "ghost",
      onClick: () => guard(() => { ev.setTreasurer(isT ? null : pid); changed(); toast(isT ? "총무를 해제했어요." : `${p.name} 님이 총무예요 👑`); }) },
    { text: "닫기", cls: "ghost" },
    { text: "이름 바꾸기", onClick: rename },
  ], { top: true });                       // 키보드에 가리지 않게 화면 위쪽에
  const input = s.querySelector("input");
  input.onkeydown = (e) => { if (e.key === "Enter" && rename()) closeSheet(); };
  if (!IS_MOBILE) input.focus();
}

function removePerson(pid) {
  if (!guard(() => ev.checkRemovable(pid))) return;   // 어차피 못 빼면 묻지 말고 바로 이유를
  const p = ev.participant(pid);
  const shared = ev.expenses.filter((e) => e.shared_by.includes(pid)).map((e) => e.item_name);
  const doIt = () => guard(() => { ev.removeParticipant(pid); checked.delete(pid); changed(); });
  if (shared.length) {
    setTimeout(() => confirmSheet("사람 빼기",
      `${p.name} 님을 빼면 ${shared.length}개 항목(${shared.join(", ")})을 나머지 사람들이 나눠 내게 돼요. 뺄까요?`,
      "빼기", doIt), 0);
  } else {
    doIt();
  }
}

// ---------------- 공유 ----------------
/** 휴대폰이면 공유 창, PC 면 클립보드 복사를 먼저. */
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));   // iPadOS

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// 복사·공유는 '누른 직후'에만 허락되는 브라우저(특히 아이폰 사파리)가 있어, 누른 순간 바로 부른다.
async function shareText() {
  const text = ev.summaryText();
  const copy = () => navigator.clipboard.writeText(text)
    .then(() => { toast("글을 복사했어요! 메신저에 붙여 넣으세요 📋"); return true; }).catch(() => false);
  const share = () => navigator.share({ text }).then(() => true)
    .catch((e) => (e.name === "AbortError" ? true : false));
  const order = IS_MOBILE ? [navigator.share && share, navigator.clipboard && copy]
                          : [navigator.clipboard && copy, navigator.share && share];
  for (const f of order) if (f && (await f())) return;
  sheet(`<h3>📋 정산 글</h3><p class="hint">글을 길게 눌러(또는 드래그해) 복사하세요</p>
    <pre style="white-space:pre-wrap;user-select:text">${esc(text)}</pre>`, [{ text: "닫기", cls: "ghost" }]);
}

function dataUrlToBlob(url) {          // 동기 변환 — toBlob 을 기다리지 않으려고
  const [head, body] = url.split(",");
  const bin = atob(body), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: head.slice(5, head.indexOf(";")) });
}

const bgImg = new Image();
bgImg.src = "img/bg.jpg";
const instaImg = new Image();
instaImg.src = "img/instagram.png";

/** 정산표 그림 — 결제 내역·사람별 정산·보낼 돈을 한 장에(PC 판 '화면 전체 복사'와 같은 내용). */
export function drawReport() {
  const W = 1080, P = 48, F = '-apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
  const list = ev.expensesByDate(), bal = ev.balances(), tr = ev.settle();
  const ROW = 86, DAY = 56, PROW = 86;            // 항목은 두 줄(이름·결제자)이라 넉넉히
  const rowsH = 50 + list.length * ROW + new Set(list.map((e) => e.date)).size * DAY;
  const fl = ev.fundMode ? fundLines() : [];
  const fundH = fl.length ? 40 + fl.length * 40 + 24 : 0;
  const H = 300 + fundH + rowsH + 90 + 70 + ev.participants.length * PROW + 90 + 64 + Math.max(1, tr.length) * 64 + 210;
  const cv = document.createElement("canvas");
  const SC = Math.min(1, 15000 / H);              // 아이폰 캔버스 크기 한도(약 1,600만 화소) 안으로
  cv.width = Math.round(W * SC); cv.height = Math.round(H * SC);
  const c = cv.getContext("2d");
  c.scale(SC, SC);
  c.fillStyle = "#15111F"; c.fillRect(0, 0, W, H);
  if (bgImg.complete && bgImg.naturalWidth) {      // 아래쪽에 포장마차 음식
    const h = bgImg.naturalHeight * (W / bgImg.naturalWidth);
    c.globalAlpha = .55; c.drawImage(bgImg, 0, H - h, W, h); c.globalAlpha = 1;
    const g = c.createLinearGradient(0, H - h, 0, H - h * .35);
    g.addColorStop(0, "#15111F"); g.addColorStop(1, "rgba(21,17,31,0)");
    c.fillStyle = g; c.fillRect(0, H - h, W, h * .65);
  }
  const text = (s, x, y, size, color, weight = 400, align = "left", maxW = 0) => {
    c.font = `${weight} ${size}px ${F}`; c.fillStyle = color; c.textAlign = align;
    if (maxW && c.measureText(s).width > maxW) {      // 넘치면 '…' 로 줄인다
      const chars = [...s];
      while (chars.length && c.measureText(chars.join("") + "…").width > maxW) chars.pop();
      s = chars.join("") + "…";
    }
    c.fillText(s, x, y);
  };
  const panel = (y, h) => {
    c.fillStyle = "rgba(24,19,36,.9)"; c.strokeStyle = "rgba(255,210,122,.35)"; c.lineWidth = 3;
    c.beginPath(); c.roundRect(P / 2, y, W - P, h, 34); c.fill(); c.stroke();
  };
  // 머리
  let y = 92;
  text(`🍰 ${ev.title || "더치페이 정산"}`, P, y, 54, "#FFD27A", 800, "left", W - 2 * P - 410);
  y += 52;
  text(`📅 ${ev.dateRange()} · ${ev.participants.length}명 · 지출 ${list.length}건`, P, y, 30, "#CDBBCB");
  y += 78;
  text(`총 ${won(ev.total())}`, P, y, 66, "#FF9EC0", 900);
  if (instaImg.complete && instaImg.naturalWidth) c.drawImage(instaImg, W - P - 352, 64, 36, 36);
  text("@unibunny_official", W - P, 93, 30, "#FF8DBB", 800, "right");
  y += 40;
  if (fl.length) {                                  // 모임 통장
    panel(y, fundH); y += 46;
    for (const [i, s] of fl.entries()) { text(s, P + 20, y, i ? 27 : 32, i ? "#FFF1E0" : "#FFD27A", i ? 400 : 800, "left", W - 2 * P - 40); y += 40; }
    y += fundH - 46 - fl.length * 40 + 24;
  }
  // 결제 내역
  panel(y, rowsH + 48); y += 54;
  text("🧾 결제 내역", P + 20, y, 34, "#FFD27A", 800); y += 18;
  let lastDay = null;
  for (const e of list) {
    if (e.date !== lastDay) { y += DAY; text(dayText(e.date), P + 20, y, 27, "#FFD27A", 800); lastDay = e.date; }
    y += ROW - 34;
    const who = e.shared_by.length === ev.participants.length ? "모두" : e.shared_by.map((p) => ev.participant(p).name).join("·");
    text(e.item_name, P + 40, y, 32, "#FFF1E0", 700, "left", W - 2 * P - 330);
    text(won(e.amount), W - P - 20, y, 32, "#FFF1E0", 800, "right");
    const whoR = ev.fundMode || e.shared_by.length === ev.participants.length ? "모두" : who;
    text(`${label(e.payer_id)} 결제 · ${whoR}`, P + 40, y + 34, 23, "#CDBBCB", 400, "left", W - 2 * P - 80);
    y += 34;
  }
  y += 98;
  // 사람별
  const ph = 70 + ev.participants.length * PROW;
  panel(y, ph + 26); y += 54;
  text("📊 사람별 정산", P + 20, y, 34, "#FFD27A", 800);
  for (const p of ev.participants) {
    const b = bal.get(p.id), isT = ev.fundMode && p.id === ev.treasurerId;
    const [cls, s] = isT ? ["even", "통장 관리"] : netText(b.net);
    y += PROW;
    text(label(p.id), P + 40, y - 14, 32, "#FFF1E0", 700, "left", W - 2 * P - 400);
    text(`${isT ? "통장에서 낸 돈" : "낸 돈"} ${won(b.paid)} · 내 몫 ${won(b.owed)}`, P + 40, y + 22, 23, "#CDBBCB");
    text(s, W - P - 20, y, 32, { get: "#6EE0B0", give: "#FF8FAE", even: "#CDBBCB" }[cls], 800, "right");
  }
  y += 82;
  // 보낼 돈
  const th = 64 + Math.max(1, tr.length) * 64 + 26;
  panel(y, th); y += 54;
  text("💸 이렇게 보내면 끝!", P + 20, y, 34, "#FFD27A", 800);
  for (const t of tr) { y += 64; text(`${label(t.from)}  →  ${label(t.to)}`, P + 40, y, 34, "#FFF1E0", 700, "left", W - 2 * P - 330);
                        text(won(t.amount), W - P - 20, y, 36, "#FFD27A", 900, "right"); }
  if (!tr.length) { y += 64; text("주고받을 돈이 없어요 🎉", P + 40, y, 32, "#CDBBCB"); }
  // 맨 아래 주소 — 정산표를 받은 사람이 다음 모임에서 찾아오게
  c.fillStyle = "rgba(21,17,31,.78)";
  c.beginPath(); c.roundRect(P / 2, H - 92, W - P, 64, 32); c.fill();
  text("🍰 1원 더치페이로 정산했어요", P + 10, H - 49, 25, "#FFF1E0", 700);
  text(APP_URL.replace("https://", "").replace(/\/$/, ""), W - P - 10, H - 49, 25, "#FFD27A", 800, "right");
  return cv;
}

async function shareImage() {
  const dataUrl = drawReport().toDataURL("image/png");
  const blob = dataUrlToBlob(dataUrl);
  const name = `1원더치페이_${ev.date}_${ev.title || "정산"}.png`;
  const file = new File([blob], name, { type: "image/png" });
  const copy = () => (window.ClipboardItem && navigator.clipboard?.write
    ? navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
        .then(() => { toast("정산표 그림을 복사했어요! 대화창에 붙여 넣으세요 📸"); return true; }).catch(() => false)
    : Promise.resolve(false));
  const share = () => (navigator.canShare?.({ files: [file] })
    ? navigator.share({ files: [file], title: "더치페이 정산" }).then(() => true)
        .catch((e) => (e.name === "AbortError" ? true : false))
    : Promise.resolve(false));
  for (const f of IS_MOBILE ? [share, copy] : [copy, share]) if (await f()) return;
  const url = dataUrl;                       // 아이폰은 data 주소 그림이어야 길게 눌러 저장이 잘 된다
  sheet(`<h3>📸 정산표 그림</h3><p class="hint">${IS_MOBILE ? "그림을 길게 눌러 저장하거나 복사하세요"
        : "그림을 마우스 오른쪽 단추로 눌러 '이미지 복사'를 하거나, 내려받으세요"}</p><img class="preview" src="${url}" alt="">`,
        [{ text: "내려받기", cls: "ghost", onClick: () => { download(blob, name); return false; } },
         { text: "닫기", cls: "ghost" }]);
}

async function exportFile() {
  const text = JSON.stringify(ev.toDict(), null, 1);
  const name = `${ev.date} ${ev.title || "정산"}.dpay.json`;
  const file = new File([text], name, { type: "application/json" });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === "AbortError") return; }
  download(file, name);
  toast("파일로 내보냈어요 📤");
}

async function importFile(f) {
  try {
    if (f.size > 2_000_000) throw new DutchPayError("파일이 너무 커요(2MB 까지).");
    const e = Event.fromDict(JSON.parse(await f.text()));
    addAndOpen(e);
    render();
    toast(`'${e.title || e.date}' 을(를) 가져왔어요 📥`);
  } catch (e) {
    toast(`가져오지 못했어요: ${e instanceof SyntaxError ? "파일 형식이 맞지 않아요" : e.message}`);
  }
}

// ---------------- 연결 ----------------
function wire() {
  for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => setTab(b.dataset.tab);
  $("evDate").onchange = () => {
    const v = $("evDate").value;
    if (!v) { $("evDate").value = ev.date; return; }      // 아이폰 '지우기' — 비워 두지 않는다
    if (formDate === ev.date) formDate = v;    // 쓴 돈 날짜를 따로 안 바꿨으면 따라간다
    ev.date = v;
    if (ev.endDate && ev.endDate <= v) ev.endDate = "";   // 끝이 시작보다 같거나 빠르면 하루짜리로
    changed();
  };
  $("evEnd").onchange = () => {
    const v = $("evEnd").value;
    ev.endDate = v && v > ev.date ? v : "";      // 비우거나 시작보다 앞이면 하루짜리
    changed();
  };
  $("evTitle").oninput = () => { ev.title = $("evTitle").value.trim(); save(); };
  $("personForm").onsubmit = (e) => {
    e.preventDefault();
    if (guard(() => { const p = ev.addParticipant($("personName").value); checked.add(p.id); })) {
      $("personName").value = "";
      changed();
    }
  };
  $("people").onclick = (e) => { const b = e.target.closest("[data-pid]"); if (b) personSheet(+b.dataset.pid); };
  $("exDate").onchange = () => {
    if ($("exDate").value) formDate = $("exDate").value;
    else $("exDate").value = formDate;
  };
  $("exAmount").oninput = () => {               // 치는 대로 쉼표(54000 → 54,000)
    const digits = $("exAmount").value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "").slice(0, 13);
    $("exAmount").value = digits ? Number(digits).toLocaleString("en-US") : "";
  };
  $("sharers").onclick = (e) => {
    const b = e.target.closest("[data-pid]");
    if (!b) return;
    const pid = +b.dataset.pid;
    checked.has(pid) ? checked.delete(pid) : checked.add(pid);
    b.classList.toggle("on", checked.has(pid));
  };
  $("allBtn").onclick = () => {                // 모두 켜져 있으면 모두 끄기
    const all = ev.participants.every((p) => checked.has(p.id));
    checked = all ? new Set() : new Set(ev.participants.map((p) => p.id));
    render();
  };
  for (const id of ["fund", "fee"]) {          // 치는 대로 쉼표, 칸을 나가면 저장(잘못되면 되돌림)
    $(id).oninput = () => {
      const digits = $(id).value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "").slice(0, 13);
      $(id).value = digits ? Number(digits).toLocaleString("en-US") : "";
    };
    $(id).onchange = applyFund;
  }
  $("surplus").onchange = applyFund;
  $("submitBtn").onclick = submitExpense;
  $("exAmount").onkeydown = (e) => { if (e.key === "Enter") submitExpense(); };
  $("cancelBtn").onclick = () => { clearForm(); render(); };
  $("deleteBtn").onclick = () => confirmSheet("지우기", "이 항목을 지울까요?", "지우기", () => {
    ev.removeExpense(editingId); clearForm(); changed(); toast("지웠어요 🧹");
  });
  $("expenses").onclick = (e) => { const r = e.target.closest("[data-eid]"); if (r) editExpense(+r.dataset.eid); };
  $("shareImg").onclick = shareImage;
  $("shareText").onclick = shareText;
  $("newBtn").onclick = $("newBtnTop").onclick = newEvent;   // 목록 탭·사람 탭 맨 위, 같은 동작
  window.addEventListener("storage", (e) => {   // 다른 탭·홈 화면 앱에서 바뀌면 따라간다
    if (e.key !== STORE_KEY || DEMO) return;
    store = loadStore();
    const rec = store.events[curId];
    if (rec && editingId === null) { try { ev = Event.fromDict(rec.data); } catch { /* 그대로 */ } }
    render();
  });
  $("library").onclick = (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      const id = del.dataset.del;
      confirmSheet("정산 지우기", "이 정산을 지울까요? 지우면 되돌릴 수 없어요.", "지우기", () => {
        commit((s) => { delete s.events[id]; });
        if (id === curId) {
          curId = null;
          const rest = Object.keys(store.events);
          if (!(rest.length && openEvent(rest[0]))) startNew();
        }
        render();
      });
      return;
    }
    const row = e.target.closest("[data-id]");
    if (!row) return;
    if (row.dataset.id === curId || openEvent(row.dataset.id)) { render(); setTab("settle"); }
  };
  // 홈 화면에 설치 — 안드로이드(Chrome·삼성)는 설치 창을 바로 띄우고, 아이폰은 Safari 공유 메뉴를 안내한다.
  // 이미 홈 화면 앱으로 열었으면(standalone) 카드를 보이지 않는다.
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; });
  window.addEventListener("appinstalled", () => { $("installCard").hidden = true; toast("홈 화면에 설치했어요 📲"); });
  $("installCard").hidden = standalone;
  const IS_WIN = /Windows/i.test(navigator.userAgent);
  if (!IS_MOBILE && IS_WIN) {   // Windows PC: 창이 있는 PC 판(설치 파일)을 안내하고, 브라우저 앱 설치는 설치 창이 뜰 때만 둘째 단추로
    $("installTitle").textContent = "💻 PC 에 설치";
    $("installHint").textContent = "PC 에서는 세 칸이 나란히 보이는 PC 판이 편해요. 설치 파일(DutchPay_Setup)을 받아 실행하세요. "
      + "서명이 없는 파일이라 Windows 가 경고하면 '추가 정보 → 실행'을 누르면 돼요. 정산 파일(.dpay.json)은 서로 주고받을 수 있어요.";
    $("pcInstallBtn").hidden = false;
    $("installBtn").hidden = true;
    $("installBtn").textContent = "🌐 브라우저 앱으로도 설치";
    $("installBtn").classList.replace("lav", "ghost");
    window.addEventListener("beforeinstallprompt", () => { $("installBtn").hidden = false; });
  } else if (!IS_MOBILE) {      // Mac·리눅스: PC 판(Windows 전용)은 없고, 브라우저 앱으로 설치(Chrome·Edge 는 설치 창, Safari 는 Dock 에 추가)
    $("installTitle").textContent = "💻 이 컴퓨터에 설치";
    $("installHint").textContent = "브라우저 앱으로 설치하면 Dock·앱 목록에서 바로 열리고 주소창 없이 써요. 인터넷이 안 돼도 열려요.";
    $("installBtn").textContent = "💻 앱으로 설치";
  }
  $("installBtn").onclick = async () => {
    if (installEvt) {
      const evt = installEvt; installEvt = null;
      evt.prompt();
      const r = await evt.userChoice.catch(() => ({ outcome: "dismissed" }));
      if (r.outcome !== "accepted") installEvt = evt;   // 취소했으면 다시 누를 수 있게
      return;
    }
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    let how;
    if (ios) how = `<p>Safari 로 열고, 화면 아래 <b>공유</b> 단추(네모에서 화살표가 올라가는 모양)를 누른 뒤 <b>홈 화면에 추가</b> 를 고르세요.</p>
         <p class="hint">카톡·인스타 안에서 열렸다면 오른쪽 위 메뉴에서 'Safari 로 열기'를 먼저 하세요.</p>`;
    else if (IS_MOBILE) how = `<p>브라우저 오른쪽 위 메뉴(⋮)를 누르고 <b>홈 화면에 추가</b> 또는 <b>앱 설치</b> 를 고르세요.</p>
         <p class="hint">삼성 인터넷은 아래 메뉴(≡) → <b>현재 페이지 추가</b> → <b>홈 화면</b>. 카톡 안에서 열렸다면 먼저 '다른 브라우저로 열기'를 하세요.</p>`;
    else how = `<p><b>Chrome·Edge</b>: 주소창 오른쪽 끝의 <b>설치</b> 아이콘(모니터에 화살표)을 누르거나, 메뉴(⋮) → <b>앱 설치</b> / <b>Dock 에 추가</b>.</p>
         <p><b>Safari(Mac)</b>: 메뉴 <b>파일 → Dock 에 추가</b>, 또는 <b>공유</b> 단추 → <b>Dock 에 추가</b>.</p>
         <p class="hint">Firefox 는 앱 설치를 지원하지 않아요. 북마크로 쓰거나 다른 브라우저로 여세요.</p>`;
    sheet(`<h3>${IS_MOBILE ? "📲 홈 화면에 설치" : "💻 이 컴퓨터에 설치"}</h3>` + how, [{ text: "알겠어요" }]);
  };
  $("exportBtn").onclick = exportFile;
  $("importFile").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importFile(f); };
}

// ---------------- 시작 ----------------
function demo() {   // ?demo=1 — 설명·화면 확인용 예시(제주 2박3일)
  const e = new Event({ date: "2026-11-07", endDate: "2026-11-09", title: "제주 2박3일" });
  for (const n of ["철수", "영희", "민수", "지은"]) e.addParticipant(n);
  for (const [d, it, a, p, s] of [["2026-11-07", "공항 김밥", 12000, 1, [1, 2, 3, 4]], ["2026-11-07", "렌터카", 168000, 2, [1, 2, 3, 4]],
    ["2026-11-07", "흑돼지", 154000, 1, [1, 2, 3, 4]], ["2026-11-07", "편의점", 23400, 3, [1, 3]], ["2026-11-08", "해장국", 36000, 4, [1, 2, 3, 4]],
    ["2026-11-08", "카페", 27500, 2, [2, 4]], ["2026-11-08", "회", 189000, 1, [1, 2, 3, 4]], ["2026-11-09", "숙소", 260000, 3, [1, 2, 3, 4]]]) {
    e.addExpense(it, a, p, s, d);
  }
  if (params.get("demo") === "club") {   // ?demo=club — 회비 모임 예시(총무 철수, 잔액 150,000 + 참가비 100,000)
    e.setTreasurer(1); e.setFund("150,000", "100,000", "carry");
  }
  store = { current: "demo", events: { demo: { saved_at: new Date().toISOString(), data: e.toDict() } } };
  openEvent("demo");
}

if (DEMO) demo();
else if (!(store.current && store.events[store.current] && openEvent(store.current))) {
  const ids = Object.keys(store.events);
  if (!(ids.length && openEvent(ids[0]))) startNew();
}
wire();
render();
const TABS = ["people", "spend", "settle", "list"];
setTab(TABS.includes(params.get("tab")) ? params.get("tab") : (ev.participants.length ? "spend" : "people"));
if (params.has("report")) {   // ?report=1 — 정산표 그림을 화면에 보여 줌(확인용)
  const show = () => { document.body.innerHTML = ""; const cv = drawReport(); cv.style.width = "100%"; document.body.append(cv); };
  bgImg.complete ? show() : (bgImg.onload = show);
}
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  // 새 버전이 설치돼 넘겨받으면 화면을 한 번 새로 고친다(글자를 치는 중이면 다음 열 때).
  // 내용은 고칠 때마다 저장돼 있으므로 새로 고쳐도 잃지 않는다.
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;   // 처음 설치(첫 방문)는 새로 고치지 않는다
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded || !hadController || !navigator.serviceWorker.controller) return;
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
    if (typing || !$("modal").hidden) return;
    reloaded = true;
    location.reload();
  });
}
