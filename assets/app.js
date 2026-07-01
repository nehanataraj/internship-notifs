/* Intern Tracker — shared app logic
   Data model (synced to a pinned Telegram message so the reminder
   cron + every device can see the same state):
   { applied, notified, notes, resume_md, deadlines, updatedAt }
*/
"use strict";

const App = (() => {
  const DATA_KEY = "jt.data.v1";
  const CFG_KEY = "jt.cfg.v1";
  const PIN_KEY = "jt.pin.v1";
  const RESUME_KEY = "jt.resume.v1";
  const MARKER = "JTRACK::";
  const CFG_REV = 3;
  /* Bot token lives ONLY in the Vercel proxy (TELEGRAM_BOT_TOKEN env var).
     The client never holds it. chat_id is a non-secret user id and the
     proxy fills in TELEGRAM_CHAT_ID when omitted. */
  const DEFAULT_CFG = {
    token: "",
    chat: "6062137847",
  };

  /* ───────── state ───────── */
  let data = loadLocal();
  let cfg = ensureCfg();
  let pinnedMsgId = null;
  let pushTimer = null;
  let companies = [];

  function loadLocal() {
    try {
      const d = JSON.parse(localStorage.getItem(DATA_KEY)) || {};
      return {
        applied: d.applied || {},
        notified: d.notified || {},
        notes: d.notes || {},
        resume_md: d.resume_md || "",
        deadlines: d.deadlines || [],
        updatedAt: d.updatedAt || 0,
      };
    } catch { return { applied: {}, notified: {}, notes: {}, resume_md: "", deadlines: [], updatedAt: 0 }; }
  }
  function saveLocal() { localStorage.setItem(DATA_KEY, JSON.stringify(data)); }

  function ensureCfg() {
    return { ...DEFAULT_CFG };
  }

  function loadCfg() {
    return ensureCfg();
  }

  function boot() {
    localStorage.removeItem("jt.proxy");
    cfg = ensureCfg();
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    localStorage.setItem("jt.cfg.rev", String(CFG_REV));
    const stored = Number(localStorage.getItem(PIN_KEY));
    if (stored) pinnedMsgId = stored;
    if (new URLSearchParams(location.search).get("embed") === "1") {
      document.body.classList.add("embed");
    }
  }

  function savePinId(id) {
    if (id) {
      pinnedMsgId = id;
      localStorage.setItem(PIN_KEY, String(id));
    }
  }

  /* magic link: legacy — credentials are hardcoded; strip hash only */
  function absorbMagicLink() {
    if (/#cfg=/.test(location.hash)) {
      cfg = ensureCfg();
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  const PROXY = "https://webapp-two-peach.vercel.app/api/telegram";

  /* ───────── telegram (via proxy — browsers cannot call api.telegram.org directly) ───────── */
  function proxyUrl() {
    if (location.hostname.endsWith(".vercel.app")) return "/api/telegram";
    return PROXY;
  }

  function normalizeToken(raw) {
    let t = String(raw).trim().replace(/^["']|["']$/g, "");
    const m = t.match(/(\d{5,}:[A-Za-z0-9_-]+)/);
    return (m ? m[1] : t.replace(/\s/g, "")).replace(/[^\d:A-Za-z0-9_-]/g, "");
  }

  function normalizeChat(raw) {
    const c = String(raw).trim().replace(/\s/g, "");
    const m = c.match(/(-?\d{5,})/);
    return m ? m[1] : c;
  }

  function sanitizeCfg(token, chat) {
    const t = normalizeToken(token);
    const c = normalizeChat(chat);
    if (!/^\d+:[A-Za-z0-9_-]{10,}$/.test(t)) {
      throw new Error("Paste the full bot token from BotFather (format: 123456789:ABC…)");
    }
    if (!/^-?\d+$/.test(c)) throw new Error("Chat ID must be numeric (e.g. 6062137847)");
    return { token: t, chat: c };
  }

  async function tg(method, params) {
    cfg = ensureCfg();
    return tgViaProxy(method, params);
  }

  async function tgViaProxy(method, params) {
    const url = proxyUrl();
    let r;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: cfg.token, method, params: params || {} }),
      });
    } catch {
      throw new Error(`Cannot reach sync proxy. Open ${PROXY.replace("/api/telegram", "")} and try again.`);
    }
    const text = await r.text();
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error(`Sync proxy returned ${r.status}. Hard-refresh the page (Ctrl+Shift+R).`);
    }
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

  async function refreshConnection() {
    cfg = ensureCfg();
    setDot("busy");
    try {
      await tg("getMe", {});
      setDot("ok");
      return true;
    } catch (e) {
      console.warn("connection check failed", e);
      setDot("err");
      return false;
    }
  }

  async function pull() {
    cfg = ensureCfg();
    try {
      const chat = await tg("getChat", { chat_id: cfg.chat });
      const pm = chat.pinned_message;
      if (pm && pm.text) {
        const remote = decodeData(pm.text);
        if (remote) {
          savePinId(pm.message_id);
          if ((remote.updatedAt || 0) > (data.updatedAt || 0)) {
            data = {
              applied: remote.applied || {},
              notified: remote.notified || {},
              notes: remote.notes || {},
              resume_md: remote.resume_md || "",
              deadlines: remote.deadlines || [],
              updatedAt: remote.updatedAt,
            };
            saveLocal();
            rerender();
          } else if ((data.updatedAt || 0) > (remote.updatedAt || 0)) {
            schedulePush();
          }
        }
      } else if (data.updatedAt) {
        schedulePush();
      }
    } catch (e) {
      console.warn("pull failed", e);
    }
  }

  async function push() {
    cfg = ensureCfg();
    const text = encodeData();
    try {
      if (pinnedMsgId) {
        try {
          await tg("editMessageText", { chat_id: cfg.chat, message_id: pinnedMsgId, text });
          return;
        } catch (e) {
          if (/exactly the same/i.test(String(e))) return;
          pinnedMsgId = null;
        }
      }
      const chat = await tg("getChat", { chat_id: cfg.chat });
      const pm = chat.pinned_message;
      if (pm?.text && decodeData(pm.text)) {
        savePinId(pm.message_id);
        try {
          await tg("editMessageText", { chat_id: cfg.chat, message_id: pinnedMsgId, text });
          return;
        } catch {
          console.warn("cannot edit pinned sync message — use InternshipJobWatcherBot token in Settings");
          return;
        }
      }
      const msg = await tg("sendMessage", { chat_id: cfg.chat, text, disable_notification: true });
      savePinId(msg.message_id);
      try {
        await tg("pinChatMessage", { chat_id: cfg.chat, message_id: pinnedMsgId, disable_notification: true });
      } catch {
        toast("Sync message sent — pin it in Telegram to finish setup");
      }
    } catch (e) {
      console.warn("push failed", e);
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
    dot.title = {
      ok: "Connected to Telegram",
      err: "Telegram connection failed — check Settings",
      busy: "Checking connection…",
      "": "Not connected — open Settings",
    }[state] || "";
    dot.setAttribute("aria-label", dot.title);
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
      cfg = ensureCfg();
      $("tgToken").value = cfg.token;
      $("tgChat").value = cfg.chat;
      $("syncStatusMsg").textContent = "";
      modal.showModal();
    });
    $("saveSyncBtn").addEventListener("click", () => {
      cfg = ensureCfg();
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
      refreshConnection().then(() => pull());
      toast("Telegram sync is always on");
    });
    $("testSyncBtn").addEventListener("click", async () => {
      const status = $("syncStatusMsg");
      status.textContent = "Sending…"; status.className = "modal-status";
      try {
        cfg = ensureCfg();
        $("tgToken").value = cfg.token;
        $("tgChat").value = cfg.chat;
        await tg("getMe", {});
        setDot("ok");
        await tg("sendMessage", {
          chat_id: cfg.chat,
          text: "Intern Tracker connected. Reminders will be sent 2 days before each OA and interview.",
        });
        localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
        status.textContent = "Delivered — check Telegram."; status.className = "modal-status ok";
        await refreshConnection();
        await pull();
        toast("Test message sent");
      } catch (e) {
        status.textContent = "Failed: " + e.message; status.className = "modal-status err";
        setDot("err");
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
    open.sort((a, b) => {
      const an = data.notified[a.slug] || 0;
      const bn = data.notified[b.slug] || 0;
      if (an && !bn) return -1;
      if (!an && bn) return 1;
      if (an && bn) return bn - an;
      return a.name.localeCompare(b.name);
    });

    const row = (c, i) => {
      const isNotified = !!(data.notified[c.slug] && !data.applied[c.slug]);
      return `
      <div class="row ${data.applied[c.slug] ? "applied" : ""} ${isNotified ? "notified" : ""}">
        <span class="idx">${String(i + 1).padStart(3, "0")}</span>
        <span class="co">${esc(c.name)}</span>
        <span class="ats"><span class="tag">${esc(c.ats)}</span></span>
        <span class="visit">${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">View</a>` : ""}</span>
        <label class="apply-toggle">
          <input type="checkbox" data-slug="${c.slug}" ${data.applied[c.slug] ? "checked" : ""} aria-label="Applied to ${esc(c.name)}">
          <span class="apply-box" aria-hidden="true">&#10003;</span>
          <span class="apply-label">Applied</span>
        </label>
      </div>`;
    };

    let html = "";
    if (open.length) html += `<div class="board-section-label">Not applied (${open.length})</div>` + open.map(row).join("");
    if (done.length) html += `<div class="board-section-label">Applied (${done.length})</div>` + done.map(row).join("");
    if (!html) html = `<div class="empty-msg">No companies match that search.</div>`;
    board.innerHTML = html;

    board.querySelectorAll("input[data-slug]").forEach(cb => {
      cb.addEventListener("change", () => {
        const slug = cb.dataset.slug;
        mutate(d => {
          if (cb.checked) {
            d.applied[slug] = Date.now();
            delete d.notified[slug];
          } else {
            delete d.applied[slug];
          }
        });
        toast(cb.checked ? "Marked as applied" : "Moved back to open");
      });
    });

    const total = companies.length, applied = Object.keys(data.applied).length;
    $("stats").innerHTML = `
      <span class="stat"><span class="stat-val">${total - applied}</span>open</span>
      <span class="stat"><span class="stat-val">${applied}</span>applied</span>
      <span class="stat"><span class="stat-val">${total ? Math.round(applied / total * 100) : 0}%</span>complete</span>`;
    const cc = $("companyCount"); if (cc) cc.textContent = total;
  }

  async function initBoard() {
    boot();
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
    refreshConnection().then(() => pull());
  }

  /* ───────── resume tailor page ───────── */
  const RESUME_API_PROXY = "https://webapp-two-peach.vercel.app/api/resume";
  let tailoredResume = "";

  function resumeApi(path) {
    if (location.hostname.endsWith(".vercel.app")) return `/api/resume/${path}`;
    return `${RESUME_API_PROXY}/${path}`;
  }

  function loadSavedResume() {
    try {
      const local = JSON.parse(localStorage.getItem(RESUME_KEY));
      if (local?.markdown) return local.markdown;
    } catch { /* ignore */ }
    return data.resume_md || "";
  }

  function saveResumeMarkdown(text) {
    const md = text.trim();
    localStorage.setItem(RESUME_KEY, JSON.stringify({ markdown: md, savedAt: Date.now() }));
    mutate(d => { d.resume_md = md; });
    toast("Resume saved");
  }

  async function initResume() {
    boot();
    absorbMagicLink();
    wireSettings();

    const editor = $("resumeEditor");
    const jd = $("jobDescription");
    const status = $("resumeStatus");
    const results = $("resumeResults");
    const fileInput = $("resumeFile");

    if (editor) editor.value = loadSavedResume();

    $("saveResumeBtn")?.addEventListener("click", () => {
      if (!editor?.value.trim()) {
        status.textContent = "Paste or upload your resume first.";
        status.className = "resume-status err";
        return;
      }
      saveResumeMarkdown(editor.value);
      status.textContent = "Resume saved — tailor as many jobs as you like.";
      status.className = "resume-status ok";
    });

    fileInput?.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      editor.value = await file.text();
      status.textContent = `Loaded ${file.name}`;
      status.className = "resume-status ok";
      fileInput.value = "";
    });

    $("tailorResumeBtn")?.addEventListener("click", async () => {
      if (!editor?.value.trim()) {
        status.textContent = "Add your resume first.";
        status.className = "resume-status err";
        return;
      }
      if (!jd?.value.trim()) {
        status.textContent = "Paste the job description.";
        status.className = "resume-status err";
        return;
      }
      status.textContent = "Tailoring (~10 keyword swaps)…";
      status.className = "resume-status";
      $("tailorResumeBtn").disabled = true;
      try {
        const r = await fetch(resumeApi("tailor-md"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resume_text: editor.value,
            job_description: jd.value,
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : (j.detail?.[0]?.msg || j.error || "Tailor failed"));
        tailoredResume = j.tailored_resume || "";
        $("changelogBody").textContent = j.changelog || "";
        $("alignmentBody").textContent = j.alignment_notes || "";
        $("swapCount").textContent = `${j.replacements_applied ?? "?"} swaps`;
        results.hidden = false;
        status.textContent = "Done — download PDF when ready.";
        status.className = "resume-status ok";
      } catch (e) {
        status.textContent = e.message;
        status.className = "resume-status err";
      } finally {
        $("tailorResumeBtn").disabled = false;
      }
    });

    $("downloadPdfBtn")?.addEventListener("click", async () => {
      if (!tailoredResume) return;
      status.textContent = "Building PDF…";
      try {
        const r = await fetch(resumeApi("md-to-pdf"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markdown: tailoredResume }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.detail || "PDF failed");
        }
        const blob = await r.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "tailored_resume.pdf";
        a.click();
        URL.revokeObjectURL(a.href);
        status.textContent = "PDF downloaded.";
        status.className = "resume-status ok";
      } catch (e) {
        status.textContent = e.message;
        status.className = "resume-status err";
      }
    });

    $("printPdfBtn")?.addEventListener("click", () => {
      if (!tailoredResume) return;
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(`<pre style="font-family:Inter,system-ui,sans-serif;white-space:pre-wrap;padding:24px">${esc(tailoredResume)}</pre>`);
      w.document.close();
      w.print();
    });

    rerender = () => {
      if (editor && !editor.value && data.resume_md) editor.value = data.resume_md;
    };
    refreshConnection().then(() => pull());
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
          ${evs.map(ev => `<span class="tag" title="${esc(ev.company)} — ${ev.kind}${ev.notes ? " · " + esc(ev.notes) : ""}">${esc(ev.company)}</span>`).join("")}
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
          <span class="countdown ${days <= 2 && !isPast ? "soon" : ""}">${cd}<br><button type="button" class="del" data-id="${ev.id}" aria-label="Remove event">Remove</button></span>
          <div class="up-meta"><span class="tag">${ev.kind}</span>${ev.time ? `<span>${ev.time}</span>` : ""}${ev.notes ? `<span>${esc(ev.notes)}</span>` : ""}</div>
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
    boot();
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
    refreshConnection().then(() => pull());
  }

  /* ───────── recruiter template page ───────── */
  const RECRUITER_API_PROXY = "https://webapp-two-peach.vercel.app/api/recruiter";

  function recruiterApi(path) {
    if (location.hostname.endsWith(".vercel.app")) return `/api/recruiter/${path}`;
    return `${RECRUITER_API_PROXY}/${path}`;
  }

  async function initRecruiter() {
    boot();
    absorbMagicLink();
    wireSettings();

    const context = $("recruiterContext");
    const output = $("recruiterOutput");
    const status = $("recruiterStatus");
    const charCount = $("charCount");
    const copyBtn = $("copyRecruiterBtn");
    const modeBtns = document.querySelectorAll(".mode-btn");
    let mode = "email";

    function updateCharCount() {
      if (!charCount || !output) return;
      const len = output.value.length;
      if (mode !== "linkedin" || !output.value.trim()) {
        charCount.hidden = true;
        return;
      }
      charCount.hidden = false;
      charCount.textContent = `${len}/300`;
      charCount.classList.toggle("over", len > 300);
    }

    modeBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        mode = btn.dataset.mode || "email";
        modeBtns.forEach(b => {
          const on = b === btn;
          b.classList.toggle("active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        updateCharCount();
      });
    });

    $("generateRecruiterBtn")?.addEventListener("click", async () => {
      if (!context?.value.trim()) {
        status.textContent = "Add conversation context first.";
        status.className = "resume-status err";
        return;
      }
      status.textContent = mode === "linkedin" ? "Generating LinkedIn note (≤300 chars)…" : "Generating email…";
      status.className = "resume-status";
      $("generateRecruiterBtn").disabled = true;
      copyBtn.disabled = true;
      try {
        const r = await fetch(recruiterApi("fill"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            context: context.value,
            name: $("recName")?.value || "",
            event: $("recEvent")?.value || "",
            role: $("recRole")?.value || "",
            your_name: $("recYourName")?.value || "",
          }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Generation failed");
        output.value = j.message || "";
        copyBtn.disabled = !output.value.trim();
        updateCharCount();
        status.textContent = mode === "linkedin" ? "LinkedIn note ready — copy and send." : "Email ready — copy and send.";
        status.className = "resume-status ok";
      } catch (e) {
        status.textContent = e.message;
        status.className = "resume-status err";
      } finally {
        $("generateRecruiterBtn").disabled = false;
      }
    });

    copyBtn?.addEventListener("click", async () => {
      if (!output?.value.trim()) return;
      try {
        await navigator.clipboard.writeText(output.value);
        toast("Copied to clipboard");
      } catch {
        output.select();
        document.execCommand("copy");
        toast("Copied to clipboard");
      }
    });

    rerender = () => {};
    refreshConnection().then(() => pull());
  }

  /* ───────── utils ───────── */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  let rerender = () => {};

  return { initBoard, initCalendar, initResume, initRecruiter };
})();
