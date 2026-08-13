// ---- Firebase init ----
firebase.initializeApp(window.FIREBASE_CONFIG);
const db = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  console.warn("Offline persistence not enabled:", err.code);
});

const chartsRef = db.collection("charts");

// ---- State ----
let allCharts = [];      // everything we've received from Firestore
let activeTag = null;    // currently selected tag filter, or null for "all"

// ---- DOM refs ----
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");
const searchEl = document.getElementById("search");
const tagBarEl = document.getElementById("tagBar");

// ---- Real-time listener ----
chartsRef.orderBy("createdAt", "desc").onSnapshot(
  (snapshot) => {
    allCharts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    statusEl.textContent = snapshot.metadata.fromCache
      ? `${allCharts.length} charts (offline copy)`
      : `${allCharts.length} charts`;
    renderTagBar();
    renderList();
  },
  (err) => {
    statusEl.textContent = "Connection error — showing offline copy if available.";
    console.error(err);
  }
);

// ---- Rendering ----
function renderTagBar() {
  const tagSet = new Set();
  allCharts.forEach((c) => (c.tags || []).forEach((t) => tagSet.add(t)));
  const tags = [...tagSet].sort();

  tagBarEl.innerHTML = "";
  const allBtn = makeTagBtn("All", activeTag === null, () => {
    activeTag = null;
    renderTagBar();
    renderList();
  });
  tagBarEl.appendChild(allBtn);

  tags.forEach((tag) => {
    const btn = makeTagBtn(tag, activeTag === tag, () => {
      activeTag = activeTag === tag ? null : tag;
      renderTagBar();
      renderList();
    });
    tagBarEl.appendChild(btn);
  });
}

function makeTagBtn(label, isActive, onClick) {
  const btn = document.createElement("button");
  btn.className = "tag-btn" + (isActive ? " active" : "");
  btn.textContent = label;
  btn.onclick = onClick;
  return btn;
}

function renderList() {
  const q = searchEl.value.trim().toLowerCase();

  const filtered = allCharts.filter((c) => {
    const matchesTag = !activeTag || (c.tags || []).includes(activeTag);
    if (!matchesTag) return false;
    if (!q) return true;
    const haystack = (
      (c.title || "") +
      " " +
      (c.tags || []).join(" ") +
      " " +
      (c.author || "")
    ).toLowerCase();
    return haystack.includes(q);
  });

  listEl.innerHTML = "";
  emptyEl.style.display = filtered.length === 0 ? "block" : "none";

  filtered.forEach((c) => {
    const card = document.createElement("div");
    card.className = "card";
    card.onclick = () => openView(c);

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = c.title || "(untitled)";
    card.appendChild(title);

    const tagsDiv = document.createElement("div");
    tagsDiv.className = "card-tags";
    (c.tags || []).forEach((t) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = t;
      tagsDiv.appendChild(chip);
    });
    card.appendChild(tagsDiv);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const when = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate().toLocaleDateString() : "";
    meta.textContent = [c.author, when].filter(Boolean).join(" • ");
    card.appendChild(meta);

    listEl.appendChild(card);
  });
}

searchEl.addEventListener("input", renderList);

// ---- Add chart ----
function openAdd() {
  document.getElementById("addModal").style.display = "block";
  document.getElementById("saveMsg").textContent = "";
}
function closeAdd() {
  document.getElementById("addModal").style.display = "none";
  document.getElementById("f_title").value = "";
  document.getElementById("f_tags").value = "";
  document.getElementById("f_html").value = "";
  document.getElementById("f_author").value = "";
}

async function saveChart() {
  const title = document.getElementById("f_title").value.trim();
  const tagsRaw = document.getElementById("f_tags").value.trim();
  const html = document.getElementById("f_html").value;
  const author = document.getElementById("f_author").value.trim();
  const saveMsg = document.getElementById("saveMsg");
  const saveBtn = document.getElementById("saveBtn");

  if (!title || !html) {
    saveMsg.textContent = "Title and chart HTML are required.";
    return;
  }

  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  saveBtn.disabled = true;
  saveMsg.textContent = "Saving…";

  try {
    await chartsRef.add({
      title,
      tags,
      html,
      author,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    saveMsg.textContent = "Saved!";
    setTimeout(closeAdd, 500);
  } catch (err) {
    console.error(err);
    saveMsg.textContent = "Failed to save: " + err.message;
  } finally {
    saveBtn.disabled = false;
  }
}

// ---- View chart ----
function openView(chart) {
  document.getElementById("viewTitle").textContent = chart.title || "";
  const frame = document.getElementById("viewFrame");
  frame.srcdoc = chart.html;
  document.getElementById("viewModal").style.display = "block";
}
function closeView() {
  document.getElementById("viewModal").style.display = "none";
  document.getElementById("viewFrame").srcdoc = "";
}

// ---- PWA install ----
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(console.error);
  });
}
