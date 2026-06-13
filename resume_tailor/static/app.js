const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const fileNameEl = document.getElementById("file-name");
const resumeText = document.getElementById("resume-text");
const jobDescription = document.getElementById("job-description");
const writingStyle = document.getElementById("writing-style");
const tailorBtn = document.getElementById("tailor-btn");
const statusEl = document.getElementById("status");
const resultsSection = document.getElementById("results");
const insightsSection = document.getElementById("insights");
const changelogBody = document.getElementById("changelog-body");
const alignmentBody = document.getElementById("alignment-body");
const resultBody = document.getElementById("result-body");
const copyBtn = document.getElementById("copy-btn");
const copyChangelogBtn = document.getElementById("copy-changelog-btn");
const copyAlignmentBtn = document.getElementById("copy-alignment-btn");
const downloadMdBtn = document.getElementById("download-md-btn");
const downloadDocxBtn = document.getElementById("download-docx-btn");
const tabs = document.querySelectorAll(".tab");

let resultData = {
  tailored_resume: "",
  changelog: "",
  alignment_notes: "",
};
let activeTab = "resume";
let docxUploadId = null;
let sessionId = null;
let lastDocxFile = null;

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = "status" + (type ? ` ${type}` : "");
}

function showInsights(changelog, alignment) {
  changelogBody.textContent = changelog || "No changes listed.";
  alignmentBody.textContent = alignment || "No alignment notes.";
}

function showTab(name) {
  activeTab = name;
  tabs.forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  const keyMap = {
    resume: "tailored_resume",
    "changelog-md": "changelog",
    "alignment-md": "alignment_notes",
  };
  resultBody.textContent = resultData[keyMap[name]] || "";
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => showTab(tab.dataset.tab));
});

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  const ext = file.name.toLowerCase();
  if (!ext.endsWith(".docx")) {
    setStatus("Please upload a .docx Word file so we can return the same format.", "error");
    return;
  }

  lastDocxFile = file;
  setStatus("Reading your Word resume…");
  fileNameEl.hidden = false;
  fileNameEl.textContent = file.name;

  const form = new FormData();
  form.append("file", file);

  try {
    const res = await fetch("/api/extract", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Upload failed");
    resumeText.value = data.text;
    docxUploadId = data.docx_upload_id || null;
    setStatus("Resume loaded. Add the job description, then click Tailor resume.", "success");
  } catch (err) {
    lastDocxFile = null;
    setStatus(err.message, "error");
  }
}

async function downloadDocxFile() {
  if (!sessionId) return;
  const res = await fetch(`/api/download/${sessionId}/resume.docx`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Download failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tailored_resume.docx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

tailorBtn.addEventListener("click", async () => {
  const resume = resumeText.value.trim();
  const jd = jobDescription.value.trim();
  const style = writingStyle.value.trim();

  if (!lastDocxFile) {
    setStatus("Upload your resume as a .docx file first.", "error");
    return;
  }
  if (!resume) {
    setStatus("Upload a .docx resume (text will appear above).", "error");
    return;
  }
  if (!jd) {
    setStatus("Paste the job description.", "error");
    return;
  }

  tailorBtn.disabled = true;
  tailorBtn.classList.add("loading");
  const started = Date.now();
  const timer = setInterval(() => {
    const sec = Math.floor((Date.now() - started) / 1000);
    setStatus(`Tailoring… ${sec}s (may switch models if servers are busy)`);
  }, 1000);
  setStatus("Tailoring… 0s (may switch models if servers are busy)");

  const form = new FormData();
  form.append("resume_text", resume);
  form.append("job_description", jd);
  form.append("writing_style", style);
  form.append("source_docx", lastDocxFile, lastDocxFile.name);
  if (docxUploadId) {
    form.append("docx_upload_id", docxUploadId);
  }

  try {
    const res = await fetch("/api/tailor", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Tailoring failed");

    sessionId = data.session_id;
    resultData = {
      tailored_resume: data.tailored_resume,
      changelog: data.changelog,
      alignment_notes: data.alignment_notes,
    };

    showInsights(resultData.changelog, resultData.alignment_notes);
    showTab("resume");

    resultsSection.hidden = false;
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    const n = data.replacements_applied;
    const rewordMsg =
      typeof n === "number"
        ? `${n} keyword swap${n === 1 ? "" : "s"} applied in your Word file`
        : "Keyword swaps applied in your Word file";
    setStatus(`Done — ${rewordMsg} (~8–10 words max). Download below; see swaps in What changed.`, "success");

    await downloadDocxFile();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    clearInterval(timer);
    tailorBtn.disabled = false;
    tailorBtn.classList.remove("loading");
  }
});

copyChangelogBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(changelogBody.textContent);
  setStatus("What changed — copied to clipboard.", "success");
});

copyAlignmentBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(alignmentBody.textContent);
  setStatus("Alignment outlook — copied to clipboard.", "success");
});

copyBtn.addEventListener("click", async () => {
  const text = resultBody.textContent;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus("Copied to clipboard.", "success");
});

downloadDocxBtn.addEventListener("click", async () => {
  if (!sessionId) return;
  try {
    await downloadDocxFile();
    setStatus("Downloaded tailored_resume.docx — fully editable in Word.", "success");
  } catch (err) {
    setStatus(err.message, "error");
  }
});

downloadMdBtn.addEventListener("click", () => {
  const keyMap = {
    resume: "tailored_resume",
    "changelog-md": "changelog",
    "alignment-md": "alignment_notes",
  };
  const key = keyMap[activeTab] || "tailored_resume";
  const text = resultData[key];
  if (!text) return;

  const names = {
    tailored_resume: "tailored_resume.md",
    changelog: "changelog.md",
    alignment_notes: "alignment_notes.md",
  };
  const blob = new Blob([text], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = names[key];
  a.click();
  URL.revokeObjectURL(a.href);
});

async function loadSavedWritingStyle() {
  try {
    const res = await fetch("/api/writing-style");
    const data = await res.json();
    if (res.ok && data.text && !writingStyle.value.trim()) {
      writingStyle.value = data.text;
    }
  } catch {
    /* optional */
  }
}

loadSavedWritingStyle();
