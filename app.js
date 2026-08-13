// ---- Clean up any old service worker from a previous version of this app ----
// (A cached service worker was causing stale content to be served — this
// removes it so every device starts fresh.)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  });
  if (window.caches) {
    caches.keys().then((names) => names.forEach((name) => caches.delete(name)));
  }
}

// ---- Firebase init ----
firebase.initializeApp(window.FIREBASE_CONFIG);
const db = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  console.warn("Offline persistence not enabled:", err.code);
});

const chartsRef = db.collection("charts");

// ---- Fixed category orders (controls sort order in the UI) ----
const CLINICAL_SCIENCES = [
  "Medicine",
  "Pediatrics",
  "Obstetrics & Gynecology",
  "Psychiatry",
  "Surgery",
];

const SYSTEMS = [
  "Nutrition",
  "Social Sciences: Legal/Ethical Issues & Professionalism/Systems-based Practice & Patient Safety",
  "Renal & Urinary System & Reproductive Systems",
  "Cardiovascular System",
  "Musculoskeletal System/Skin & Subcutaneous Tissue",
  "Behavioral Health",
  "Blood & Lymphoreticular/Immune Systems",
  "Gastrointestinal System",
  "Nervous System & Special Senses",
  "Respiratory System",
  "Multisystem Processes & Disorders",
  "Endocrine System",
  "Pregnancy, Childbirth & the Puerperium",
  "Biostatistics & Epidemiology/Population Health/Interpretation of Medical Literature",
  "Human Development**",
];

// ---- State ----
let allCharts = [];
let activeClinical = null;
let activeSystem = null;

// ---- DOM refs ----
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");
const searchEl = document.getElementById("search");
const tagBarEl = document.getElementById("tagBar");
const sysBarEl = document.getElementById("sysBar");

// ---- Real-time listener ----
chartsRef.orderBy("createdAt", "desc").onSnapshot(
  (snapshot) => {
    allCharts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    statusEl.textContent = snapshot.metadata.fromCache
      ? `${allCharts.length} charts (offline copy)`
      : `${allCharts.length} charts`;
    renderFilterBars();
    renderList();
  },
  (err) => {
    statusEl.textContent = "Connection error: " + err.message;
    console.error(err);
  }
);

// ---- Filter bars ----
function renderFilterBars() {
  tagBarEl.innerHTML = "";
  tagBarEl.appendChild(
    makeBtn("All", activeClinical === null, "tag-btn", () => {
      activeClinical = null;
      renderFilterBars();
      renderList();
    })
  );
  CLINICAL_SCIENCES.forEach((cs) => {
    tagBarEl.appendChild(
      makeBtn(cs, activeClinical === cs, "tag-btn", () => {
        activeClinical = activeClinical === cs ? null : cs;
        renderFilterBars();
        renderList();
      })
    );
  });

  sysBarEl.innerHTML = "";
  sysBarEl.appendChild(
    makeBtn("All", activeSystem === null, "tag-btn sys-btn", () => {
      activeSystem = null;
      renderFilterBars();
      renderList();
    })
  );
  SYSTEMS.forEach((sys) => {
    sysBarEl.appendChild(
      makeBtn(shortSystemLabel(sys), activeSystem === sys, "tag-btn sys-btn", () => {
        activeSystem = activeSystem === sys ? null : sys;
        renderFilterBars();
        renderList();
      })
    );
  });
}

function shortSystemLabel(sys) {
  return sys.split(/[/:]/)[0].trim();
}

function makeBtn(label, isActive, className, onClick) {
  const btn = document.createElement("button");
  btn.className = className + (isActive ? " active" : "");
  btn.textContent = label;
  btn.onclick = onClick;
  return btn;
}

// ---- Main list ----
function renderList() {
  const q = searchEl.value.trim().toLowerCase();

  const filtered = allCharts.filter((c) => {
    if (activeClinical && c.clinicalScience !== activeClinical) return false;
    if (activeSystem && c.system !== activeSystem) return false;
    if (!q) return true;
    const haystack = (
      (c.title || "") +
      " " +
      (c.clinicalScience || "") +
      " " +
      (c.system || "") +
      " " +
      (c.author || "")
    ).toLowerCase();
    return haystack.includes(q);
  });

  listEl.innerHTML = "";
  emptyEl.style.display = filtered.length === 0 ? "block" : "none";

  if (q) {
    filtered.forEach((c) => listEl.appendChild(makeCard(c)));
    return;
  }

  const bySystem = new Map();
  filtered.forEach((c) => {
    const key = c.system || "Uncategorized";
    if (!bySystem.has(key)) bySystem.set(key, []);
    bySystem.get(key).push(c);
  });

  const orderedKeys = [...SYSTEMS.filter((s) => bySystem.has(s))];
  if (bySystem.has("Uncategorized")) orderedKeys.push("Uncategorized");

  orderedKeys.forEach((key) => {
    const group = bySystem.get(key).sort((a, b) =>
      (a.title || "").localeCompare(b.title || "")
    );
    const header = document.createElement("div");
    header.className = "section-header";
    header.textContent = `${key} (${group.length})`;
    listEl.appendChild(header);
    group.forEach((c) => listEl.appendChild(makeCard(c)));
  });
}

function makeCard(c) {
  const card = document.createElement("div");
  card.className = "card";
  card.onclick = () => openView(c);

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = c.title || "(untitled)";
  card.appendChild(title);

  const tagsDiv = document.createElement("div");
  tagsDiv.className = "card-tags";
  if (c.clinicalScience) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = c.clinicalScience;
    tagsDiv.appendChild(chip);
  }
  if (c.system) {
    const chip = document.createElement("span");
    chip.className = "chip chip-sys";
    chip.textContent = shortSystemLabel(c.system);
    tagsDiv.appendChild(chip);
  }
  card.appendChild(tagsDiv);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  const when = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate().toLocaleDateString() : "";
  meta.textContent = [c.author, when].filter(Boolean).join(" • ");
  card.appendChild(meta);

  return card;
}

searchEl.addEventListener("input", renderList);

// ---- Add / Edit chart ----
let editingId = null; // null = adding new; otherwise the doc id being edited
let currentViewedChart = null; // chart currently open in the View modal

function openAdd() {
  editingId = null;
  document.getElementById("addModalTitle").textContent = "Add Chart";
  document.getElementById("saveBtn").textContent = "Save Chart";
  document.getElementById("addModal").style.display = "block";
  document.getElementById("saveMsg").textContent = "";
}
function closeAdd() {
  document.getElementById("addModal").style.display = "none";
  document.getElementById("f_title").value = "";
  document.getElementById("f_clinical").value = "";
  document.getElementById("f_system").value = "";
  document.getElementById("f_html").value = "";
  document.getElementById("f_author").value = "";
  editingId = null;
}

async function saveChart() {
  const title = document.getElementById("f_title").value.trim();
  const clinicalScience = document.getElementById("f_clinical").value;
  const system = document.getElementById("f_system").value;
  const html = document.getElementById("f_html").value;
  const author = document.getElementById("f_author").value.trim();
  const saveMsg = document.getElementById("saveMsg");
  const saveBtn = document.getElementById("saveBtn");

  if (!title || !html || !clinicalScience || !system) {
    saveMsg.textContent = "Title, Clinical Science, System, and Chart HTML are all required.";
    return;
  }

  saveBtn.disabled = true;
  saveMsg.textContent = editingId ? "Updating…" : "Saving…";

  try {
    if (editingId) {
      await chartsRef.doc(editingId).update({
        title,
        clinicalScience,
        system,
        tags: [clinicalScience, system],
        html,
        author,
      });
      saveMsg.textContent = "Updated!";
    } else {
      await chartsRef.add({
        title,
        clinicalScience,
        system,
        tags: [clinicalScience, system],
        html,
        author,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      saveMsg.textContent = "Saved!";
    }
    setTimeout(closeAdd, 500);
  } catch (err) {
    console.error(err);
    saveMsg.textContent = "Failed to save: " + err.message;
  } finally {
    saveBtn.disabled = false;
  }
}

// ---- View / Edit / Delete chart ----
function openView(chart) {
  currentViewedChart = chart;
  document.getElementById("viewTitle").textContent = chart.title || "";
  const frame = document.getElementById("viewFrame");
  frame.srcdoc = chart.html;
  document.getElementById("viewModal").style.display = "block";
}
function closeView() {
  document.getElementById("viewModal").style.display = "none";
  document.getElementById("viewFrame").srcdoc = "";
  currentViewedChart = null;
}

function editCurrentChart() {
  if (!currentViewedChart) return;
  const c = currentViewedChart;
  editingId = c.id;
  document.getElementById("addModalTitle").textContent = "Edit Chart";
  document.getElementById("saveBtn").textContent = "Update Chart";
  document.getElementById("f_title").value = c.title || "";
  document.getElementById("f_clinical").value = c.clinicalScience || "";
  document.getElementById("f_system").value = c.system || "";
  document.getElementById("f_html").value = c.html || "";
  document.getElementById("f_author").value = c.author || "";
  document.getElementById("saveMsg").textContent = "";
  closeView();
  document.getElementById("addModal").style.display = "block";
}

async function deleteCurrentChart() {
  if (!currentViewedChart) return;
  const title = currentViewedChart.title || "this chart";
  if (!confirm(`Delete "${title}"? This can't be undone.`)) return;
  try {
    await chartsRef.doc(currentViewedChart.id).delete();
    closeView();
  } catch (err) {
    alert("Failed to delete: " + err.message);
    console.error(err);
  }
}
