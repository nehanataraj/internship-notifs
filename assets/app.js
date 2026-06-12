/* Intern Tracker — shared app logic
   Data model (synced to a pinned Telegram message so the reminder
   cron + every device can see the same state):
   { applied: { slug: epochMs }, deadlines: [{id, company, kind, date, time, notes}], updatedAt }
*/
"use strict";

const App = (() => {
  const DATA_KEY = "jt.data.v1";
  const CFG_KEY = "jt.cfg.v1";
  const MARKER = "JTRACK::";

  /* ───────── state ───────── */
  let data = loadLocal();
  let cfg = loadCfg();
  let pinnedMsgId = null;
  let pushTimer = null;
  let companies = [];

  function loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem(DATA_KEY)) || {};
      return { applied: d.applied || {}, deadlines: d.deadlines || [], updatedAt: d.updatedAt || 0 };
    } catch { return { applied: {}, deadlines: [], updatedAt: 0 }; }
  }
  function saveLocal() { localStorage.setItem(DATA_KEY, JSON.stringify(data)); }

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch { return null; }
  }

  /* magic link: #cfg=base64(token|chat) — saved once, then stripped from URL */
  function absorbMagicLink() {
    const m = location.hash.match(/#cfg=([A-Za-z0-9+/=_-]+)/);
    if (!m) return;
    try {
      const [token, chat] = atob(m[1].replace(/-/g, "+").replace(/_/g, "/")).split("|");
      if (token && chat) {
        cfg = { token, chat };
        localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
        toast("Telegram sync configured");
      }
    } catch { /* bad link, ignore */ }
    history.replaceState(null, "", location.pathname + location.search);
  }

  /* ───────── telegram ───────── */
  async function tg(method, params) {
    if (!cfg) throw new Error("no-config");
    const r = await fetch(`https://api.telegram.org/bot${cfg.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params || {}),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || method + " failed");
    return j.result;
  }

  function encodeData() {
    return "Internship tracker data — do not unpin or delete\n" + MARKER + JSON.stringify(data);
  }
  function decodeData(text) {
    const i = text.indexOf(MARKER);
    if (i === -1) return null;
    try { return JSON.parse(text.slice(i + MARKER.length)); } catch { return null; }
  }

  async function pull() {
    if (!cfg) return setDot("");
    setDot("busy");
    try {
      const chat = await tg("getChat", { chat_id: cfg.chat });
      const pm = chat.pinned_message;
      if (pm && pm.text) {
        const remote = decodeData(pm.text);
        if (remote) {
          pinnedMsgId = pm.message_id;
          if ((remote.updatedAt || 0) > (data.updatedAt || 0)) {
            data = { applied: remote.applied || {}, deadlines: remote.deadlines || [], updatedAt: remote.updatedAt };
            saveLocal();
            rerender();
          } else if ((data.updatedAt || 0) > (remote.updatedAt || 0)) {
            schedulePush();
          }
        }
      } else if (data.updatedAt) {
        schedulePush(); // no pinned store yet — create one
      }
      setDot("ok");
    } catch (e) {
      console.warn("pull failed", e);
      setDot("err");
    }
  }

  async function push() {
    if (!cfg) return;
    setDot("busy");
    const text = encodeData();
    try {
      if (pinnedMsgId) {
        try {
          await tg("editMessageText", { chat_id: cfg.chat, message_id: pinnedMsgId, text });
        } catch (e) {
          if (!/exactly the same/i.test(String(e))) {
            pinnedMsgId = null; // stale id — recreate below
          }
        }
      }
      if (!pinnedMsgId) {
        const msg = await tg("sendMessage", { chat_id: cfg.chat, text, disable_notification: true });
        pinnedMsgId = msg.message_id;
        await tg("pinChatMessage", { chat_id: cfg.chat, message_id: pinnedMsgId, disable_notification: true });
      }
      setDot("ok");
    } catch (e) {
      console.warn("push failed", e);
      setDot("err");
    }
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 1200);
  }

  function mutate(fn) {
    fn(data);
    data.updatedAt = Date.now();
    saveLocal();
    schedulePush();
    rerender();
  }

  /* ───────── shared UI ───────── */
  function $(id) { return document.getElementById(id); }

  function setDot(state) {
    const dot = $("syncDot");
    if (!dot) return;
    dot.className = "sync-dot" + (state ? " " + state : "");
    dot.title = { ok: "Synced with Telegram", err: "Sync error — check settings", busy: "Syncing…", "": "Sync off — open Settings" }[state] || "";
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function wireSettings() {
    const modal = $("settingsModal");
    $("settingsBtn").addEventListener("click", () => {
      if (cfg) { $("tgToken").value = cfg.token; $("tgChat").value = cfg.chat; }
      $("syncStatusMsg").textContent = "";
      modal.showModal();
    });
    $("saveSyncBtn").addEventListener("click", () => {
      const token = $("tgToken").value.trim();
      const chat = $("tgChat").value.trim();
      if (token && chat) {
        cfg = { token, chat };
        localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
        pull();
        toast("Sync settings saved");
      }
    });
    $("testSyncBtn").addEventListener("click", async () => {
      const status = $("syncStatusMsg");
      const token = $("tgToken").value.trim(), chat = $("tgChat").value.trim();
      if (!token || !chat) { status.textContent = "Enter both fields first."; status.className = "modal-status err"; return; }
      status.textContent = "Sending…"; status.className = "modal-status";
      try {
        const saved = cfg; cfg = { token, chat };
        await tg("sendMessage", { chat_id: chat, text: "Intern Tracker connected. Reminders will be sent 2 days before each OA and interview." });
        cfg = saved;
        status.textContent = "Delivered — check Telegram."; status.className = "modal-status ok";
      } catch (e) {
        status.textContent = "Failed: " + e.message; status.className = "modal-status err";
      }
    });
  }

  async function loadCompanies() {
    const r = await fetch("companies.json");
    companies = await r.json();
  }

  /* ───────── board page ───────── */
  let boardFilter = { q: "", ats: "" };

  function renderBoard() {
    const board = $("board");
    if (!board) return;
    const q = boardFilter.q.toLowerCase();
    const list = companies.filter(c =>
      (!q || c.name.toLowerCase().includes(q)) && (!boardFilter.ats || c.ats === boardFilter.ats));
    const open = list.filter(c => !data.applied[c.slug]);
    const done = list.filter(c => data.applied[c.slug]);

    const row = (c, i) => `
      <div class="row ${data.applied[c.slug] ? "applied" : ""}" style="animation-delay:${Math.min(i * 12, 350)}ms">
        <span class="idx">${String(i + 1).padStart(3, "0")}</span>
        <span class="co">${esc(c.name)}</span>
        <span class="ats">${esc(c.ats)}</span>
        <span class="visit">${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">View</a>` : ""}</span>
        <label class="apply-toggle">
          <input type="checkbox" data-slug="${c.slug}" ${data.applied[c.slug] ? "checked" : ""}>
          <span class="apply-box">&#10003;</span>
          <span class="apply-label">Applied</span>
        </label>
      </div>`;

    let html = "";
    if (open.length) html += `<div class="board-section-label">Not applied (${open.length})</div>` + open.map(row).join("");
    if (done.length) html += `<div class="board-section-label">Applied (${done.length})</div>` + done.map(row).join("");
    if (!html) html = `<div class="empty-msg">No companies match that search.</div>`;
    board.innerHTML = html;

    board.querySelectorAll("input[data-slug]").forEach(cb => {
      cb.addEventListener("change", () => {
        const slug = cb.dataset.slug;
        mutate(d => { cb.checked ? d.applied[slug] = Date.now() : delete d.applied[slug]; });
        toast(cb.checked ? "Marked as applied" : "Moved back to open");
      });
    });

    const total = companies.length, applied = Object.keys(data.applied).length;
    $("stats").innerHTML = `
      <span><b>${total - applied}</b> open</span>
      <span class="stat-applied"><b>${applied}</b> applied</span>
      <span><b>${total ? Math.round(applied / total * 100) : 0}%</b> complete</span>`;
    const cc = $("companyCount"); if (cc) cc.textContent = total;
  }

  async function initBoard() {
    absorbMagicLink();
    wireSettings();
    await loadCompanies();

    const atsSel = $("atsFilter");
    [...new Set(companies.map(c => c.ats))].sort().forEach(a => {
      const o = document.createElement("option"); o.value = a; o.textContent = a.toLowerCase(); atsSel.appendChild(o);
    });
    $("searchBox").addEventListener("input", e => { boardFilter.q = e.target.value; renderBoard(); });
    atsSel.addEventListener("change", e => { boardFilter.ats = e.target.value; renderBoard(); });

    rerender = renderBoard;
    renderBoard();
    pull();
  }

  /* ───────── calendar page ───────── */
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  let calCursor = new Date();

  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function todayStr() { return ymd(new Date()); }

  function renderCalendar() {
    const grid = $("calGrid");
    if (!grid) return;
    const y = calCursor.getFullYear(), m = calCursor.getMonth();
    $("calTitle").textContent = `${MONTHS[m]} ${y}`;

    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const today = todayStr();
    const byDate = {};
    data.deadlines.forEach(ev => (byDate[ev.date] = byDate[ev.date] || []).push(ev));

    let html = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const ds = ymd(d);
      const evs = (byDate[ds] || []).slice().sort((a, b) => (a.time || "99") < (b.time || "99") ? -1 : 1);
      html += `
        <div class="cal-day ${d.getMonth() !== m ? "other-month" : ""} ${ds === today ? "today" : ""}" data-date="${ds}">
          <span class="dnum">${d.getDate()}</span>
          ${evs.map(ev => `<span class="chip ${ev.kind}" title="${esc(ev.company)} — ${ev.kind}${ev.notes ? " · " + esc(ev.notes) : ""}">${esc(ev.company)}</span>`).join("")}
        </div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll(".cal-day").forEach(el =>
      el.addEventListener("click", () => openEventModal(el.dataset.date)));

    renderUpcoming();
  }

  function renderUpcoming() {
    const list = $("upcomingList");
    if (!list) return;
    const today = todayStr();
    const evs = data.deadlines.slice().sort((a, b) =>
      (a.date + (a.time || "")) < (b.date + (b.time || "")) ? -1 : 1);
    const upcoming = evs.filter(e => e.date >= today);
    const past = evs.filter(e => e.date < today);
    $("upcomingCount").textContent = `${upcoming.length} upcoming`;

    const card = (ev, isPast) => {
      const d = parseYmd(ev.date);
      const days = Math.round((d - parseYmd(today)) / 86400000);
      const cd = isPast ? "Past" : days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
      return `
        <div class="up-card ${isPast ? "past" : ""}">
          <div class="up-date"><div class="dd">${d.getDate()}</div><div class="mm">${MONTHS[d.getMonth()].slice(0, 3)}</div></div>
          <div class="up-co">${esc(ev.company)}</div>
          <span class="countdown ${days <= 2 && !isPast ? "soon" : ""}">${cd}<br><button class="del" data-id="${ev.id}" title="delete">✕</button></span>
          <div class="up-meta"><span class="kind ${ev.kind}">${ev.kind}</span>${ev.time ? " · " + ev.time : ""}${ev.notes ? " · " + esc(ev.notes) : ""}</div>
        </div>`;
    };

    list.innerHTML =
      (upcoming.map(e => card(e, false)).join("") || `<div class="empty-msg">No events scheduled. Click a day to add one.</div>`) +
      past.slice(-3).reverse().map(e => card(e, true)).join("");

    list.querySelectorAll(".del").forEach(btn =>
      btn.addEventListener("click", () => {
        mutate(d => { d.deadlines = d.deadlines.filter(e => e.id !== btn.dataset.id); });
        toast("Event removed");
      }));
  }

  function openEventModal(dateStr) {
    $("evDate").value = dateStr || todayStr();
    $("evCompany").value = "";
    $("evTime").value = "";
    $("evNotes").value = "";
    $("eventModal").showModal();
    $("evCompany").focus();
  }

  async function initCalendar() {
    absorbMagicLink();
    wireSettings();
    await loadCompanies();

    const dl = $("companyList");
    companies.forEach(c => { const o = document.createElement("option"); o.value = c.name; dl.appendChild(o); });

    $("prevMonth").addEventListener("click", () => { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1); renderCalendar(); });
    $("nextMonth").addEventListener("click", () => { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1); renderCalendar(); });
    $("todayBtn").addEventListener("click", () => { calCursor = new Date(); renderCalendar(); });
    $("addBtn").addEventListener("click", () => openEventModal());
    $("cancelEventBtn").addEventListener("click", () => $("eventModal").close());

    $("eventForm").addEventListener("submit", e => {
      e.preventDefault();
      const ev = {
        id: Math.random().toString(36).slice(2, 10),
        company: $("evCompany").value.trim(),
        kind: $("evKind").value,
        date: $("evDate").value,
        time: $("evTime").value || "",
        notes: $("evNotes").value.trim(),
      };
      if (!ev.company || !ev.date) return;
      mutate(d => d.deadlines.push(ev));
      $("eventModal").close();
      toast(`${ev.company} added — reminder in 2 days`);
      if (cfg) {
        const d = parseYmd(ev.date);
        tg("sendMessage", {
          chat_id: cfg.chat,
          text: `Scheduled: ${ev.company} — ${ev.kind} on ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}${ev.time ? " at " + ev.time : ""}${ev.notes ? "\n" + ev.notes : ""}\nReminder in 2 days.`,
          disable_notification: true,
        }).catch(() => {});
      }
    });

    rerender = renderCalendar;
    renderCalendar();
    pull();
  }

  /* ───────── utils ───────── */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  let rerender = () => {};

  return { initBoard, initCalendar };
})();
