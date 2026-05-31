/**
 * Air Selangor Specs Search — PWA
 * Searchable index of SYABAS Standard Specifications & SPAN Uniform Technical Guidelines
 */

// ── Core: fuzzy fallback (typo tolerance) ─────────────────────────────────────

function levenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[bl];
}

function fuzzy_tokenize(text) {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function best_token_similarity(qt, candidateTokens) {
  let best = 0;
  for (const ct of candidateTokens) {
    if (ct === qt) return 1;
    let sim;
    if (ct.length >= qt.length && ct.startsWith(qt)) {
      sim = 0.95;
    } else if (qt.length >= 3 && ct.includes(qt)) {
      sim = 0.85;
    } else {
      const maxLen = Math.max(qt.length, ct.length);
      const cap = Math.ceil(maxLen * 0.5);
      const d = levenshtein(qt, ct, cap);
      sim = 1 - d / maxLen;
    }
    if (sim > best) {
      best = sim;
      if (best === 1) break;
    }
  }
  return best;
}

function fuzzy_search(items, rawQuery, limit = 20, minSim = 0.6) {
  const qtokens = fuzzy_tokenize(rawQuery);
  if (qtokens.length === 0) return [];
  const scored = [];
  for (const it of items) {
    let total = 0;
    let ok = true;
    for (const qt of qtokens) {
      const sim = best_token_similarity(qt, it._tokens);
      if (sim < minSim) { ok = false; break; }
      total += sim;
    }
    if (ok) scored.push({ item: it, score: total / qtokens.length });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.item.description.length - b.item.description.length
  );
  return scored.slice(0, limit).map((s) => format_search_result_row(s.item));
}

function prefix_search(items, rawQuery, limit = 20) {
  const qtokens = fuzzy_tokenize(rawQuery);
  if (qtokens.length === 0) return [];
  const scored = [];
  for (const it of items) {
    let total = 0;
    let ok = true;
    for (const qt of qtokens) {
      let best = 0;
      for (const ct of it._tokens) {
        if (ct === qt) { best = 2; break; }
        if (best < 1 && ct.startsWith(qt)) best = 1;
      }
      if (best === 0) { ok = false; break; }
      total += best;
    }
    if (ok) scored.push({ item: it, score: total });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.item.description.length - b.item.description.length ||
      a.item.id - b.item.id
  );
  return scored.slice(0, limit).map((s) => format_search_result_row(s.item));
}

function format_search_result_row(row) {
  return {
    id:             row.id,
    item_no:        row.item_no        || "—",
    description:    row.description    || "",
    unit:           row.unit           || "",
    doc_type:       row.doc_type       || "",
    edition_year:   row.edition_year   || 0,
    source_page:    row.source_page    || 0,
    section:        row.section        || "",
    remarks:        row.remarks        || "",
  };
}

function load_all_items(db) {
  const sql = `
    SELECT id, item_no, description, unit, doc_type,
           edition_year, source_page, section, remarks
    FROM spec_items
  `;
  const res = db.exec(sql);
  if (!res.length) return [];
  const { columns, values } = res[0];
  const idx = {};
  columns.forEach((c, k) => { idx[c] = k; });
  return values.map((v) => {
    const row = {
      id:             v[idx.id],
      item_no:        v[idx.item_no],
      description:    v[idx.description]    || "",
      unit:           v[idx.unit]           || "",
      doc_type:       v[idx.doc_type]       || "",
      edition_year:   v[idx.edition_year]   || 0,
      source_page:    v[idx.source_page]    || 0,
      section:        v[idx.section]        || "",
      remarks:        v[idx.remarks]        || "",
    };
    row._tokens = fuzzy_tokenize(
      `${row.item_no} ${row.description} ${row.unit} ${row.section} ${row.remarks}`
    );
    return row;
  });
}

// ── Ports ─────────────────────────────────────────────────────────────────────

const SearchPort = {
  search(items, query, limit = 20) {
    return prefix_search(items, query, limit);
  },

  async get_item_detail(db, item_id) {
    const stmt = db.prepare("SELECT * FROM spec_items WHERE id = ?");
    stmt.bind([String(item_id)]);
    let item = null;
    if (stmt.step()) item = stmt.getAsObject();
    stmt.free();
    return { item };
  },
};

const StoragePort = {
  async load_database()          { return IndexedDbStorageAdapter.load_database(); },
  async persist_database(bytes)  { return IndexedDbStorageAdapter.persist_database(bytes); },
};

// ── Adapters ──────────────────────────────────────────────────────────────────

const IndexedDbStorageAdapter = {
  DB_NAME:    "air-selangor-specs-db",
  STORE_NAME: "db-blobs",
  KEY:        "air-selangor-specs-v1",

  async load_database() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = (e) => { e.target.result.createObjectStore(this.STORE_NAME); };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const getReq = db.transaction(this.STORE_NAME, "readonly")
                         .objectStore(this.STORE_NAME).get(this.KEY);
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror  = () => reject(getReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async persist_database(bytes) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = (e) => { e.target.result.createObjectStore(this.STORE_NAME); };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const putReq = db.transaction(this.STORE_NAME, "readwrite")
                         .objectStore(this.STORE_NAME).put(bytes, this.KEY);
        putReq.onsuccess = () => resolve();
        putReq.onerror  = () => reject(putReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  },
};

const SqlJsAdapter = {
  SQL: null,
  async init() {
    if (this.SQL) return this.SQL;
    this.SQL = await initSqlJs({ locateFile: (f) => `vendor/${f}` });
    return this.SQL;
  },
  load_database(bytes) { return new this.SQL.Database(bytes); },
};

// ── App: CONFIG ───────────────────────────────────────────────────────────────

const CONFIG = {
  SEARCH_LIMIT:       20,
  FUZZY_MIN_SIM:      0.6,
  SEARCH_DEBOUNCE_MS: 150,
  LOCALE:             "en-MY",
  DOC_LABELS:         { syabas: "SYABAS 2007", span: "SPAN UTG 2018" },
  DB_PATH:            "assets/air-selangor-specs.db",
};

// ── App: utilities ────────────────────────────────────────────────────────────

function escape_html(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function doc_label(doc_type, year) {
  const name = CONFIG.DOC_LABELS[doc_type] || doc_type;
  return year ? `${name}` : name;
}

function format_remarks(text) {
  if (!text) return "<p class=\"no-rates\">Tiada teks tambahan.</p>";
  // Preserve line breaks, but wrap in paragraphs for readability
  const paragraphs = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p>${escape_html(line)}</p>`)
    .join("");
  return paragraphs || "<p class=\"no-rates\">Tiada teks tambahan.</p>";
}

// ── App: DOM refs & status ────────────────────────────────────────────────────

const els = {
  searchInput: document.getElementById("search-input"),
  resultsList: document.getElementById("results-list"),
  statusBar:   document.getElementById("status-bar"),
  statusText:  document.getElementById("status-text"),
  filterAll:   document.getElementById("filter-all"),
  filterSyabas:document.getElementById("filter-syabas"),
  filterSpan:  document.getElementById("filter-span"),
};

function set_status(msg, loading = false) {
  els.statusText.textContent = msg;
  els.statusBar.classList.toggle("loading", loading);
}

// ── App: mutable search state ──────────────────────────────────────────────────

let sqlDb = null;
let allItems = [];
let filteredItems = [];
let activeDocFilter = "all";
let searchDebounceTimer = null;

// ── App: ResultsUI ─────────────────────────────────────────────────────────────

const ResultsUI = {
  _activeId:       null,
  _activeDetailEl: null,

  close() {
    if (this._activeDetailEl) {
      this._activeDetailEl.remove();
      this._activeDetailEl = null;
    }
    if (this._activeId !== null) {
      const prev = els.resultsList.querySelector(".result-item.active");
      if (prev) prev.classList.remove("active");
    }
    this._activeId = null;
  },

  render(results) {
    this.close();
    els.resultsList.innerHTML = "";

    if (!results.length) {
      els.resultsList.innerHTML =
        `<li class="empty-state">Tiada klausa dijumpai. Cuba kata kunci lain.</li>`;
      return;
    }

    for (const r of results) {
      const li = document.createElement("li");
      li.className = "result-item";
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.dataset.id = r.id;

      const pageLabel = r.source_page ? `Ms ${r.source_page}` : "";

      li.innerHTML = `
        <div class="row-top">
          <span class="code">${escape_html(r.item_no)}</span>
          <span class="desc">${escape_html(r.description)}</span>
        </div>
        <div class="meta">
          ${pageLabel ? `<span>${pageLabel}</span>` : ""}
          <span class="badge">${escape_html(doc_label(r.doc_type, r.edition_year))}</span>
        </div>
      `;

      li.addEventListener("click",   ()  => ResultsUI.open(r.id, li));
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") ResultsUI.open(r.id, li);
      });
      els.resultsList.appendChild(li);
    }
  },

  async open(item_id, targetLi) {
    if (!sqlDb) return;
    if (this._activeId === item_id) { this.close(); return; }
    this.close();
    this._activeId = item_id;
    targetLi.classList.add("active");
    set_status("Memuatkan…", true);
    try {
      const { item } = await SearchPort.get_item_detail(sqlDb, item_id);
      if (!item) { set_status("Item tidak dijumpai."); return; }
      this._render_detail(item, targetLi);
      set_status("Siap.");
    } catch (e) {
      console.error("Detail error:", e);
      set_status("Gagal memuatkan butiran.");
    }
  },

  _render_detail(item, targetLi) {
    const pageLabel = item.source_page ? `Muka surat ${item.source_page}` : "";
    const sectionHtml = item.section
      ? `<div class="detail-section">${escape_html(item.section)}</div>` : "";

    const detailEl = document.createElement("li");
    detailEl.className = "detail-inline";
    detailEl.innerHTML = `
      <div class="detail-header">
        <div>
          <div class="detail-code">${escape_html(item.item_no || "—")}</div>
          <div class="detail-meta">
            ${escape_html(doc_label(item.doc_type, item.edition_year))}
            ${pageLabel ? `• ${pageLabel}` : ""}
          </div>
        </div>
        <button class="close-btn" aria-label="Tutup butiran">&times;</button>
      </div>
      ${sectionHtml}
      <div class="detail-desc">${escape_html(item.description)}</div>
      <div class="detail-remarks">
        <div class="remarks-label">Teks Penuh</div>
        <div class="remarks-body">${format_remarks(item.remarks)}</div>
      </div>
    `;

    targetLi.insertAdjacentElement("afterend", detailEl);
    this._activeDetailEl = detailEl;

    detailEl.querySelector(".close-btn").addEventListener("click", () => this.close());
    detailEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  },
};

// ── App: database lifecycle ────────────────────────────────────────────────────

async function init_database() {
  set_status("Checking local database…", true);
  let bytes = null;
  try {
    bytes = await StoragePort.load_database();
  } catch (e) {
    console.warn("IndexedDB read failed:", e);
  }

  if (!bytes) {
    set_status("Downloading database…", true);
    const resp = await fetch(CONFIG.DB_PATH);
    if (!resp.ok) throw new Error("Failed to fetch database: " + resp.status);
    bytes = new Uint8Array(await resp.arrayBuffer());
    try {
      await StoragePort.persist_database(bytes);
    } catch (e) {
      console.warn("IndexedDB write failed (private browsing?):", e);
    }
  }

  set_status("Loading SQL engine…", true);
  await SqlJsAdapter.init();
  sqlDb    = SqlJsAdapter.load_database(bytes);
  allItems = load_all_items(sqlDb);
  filteredItems = allItems;
  set_status(`Ready — ${allItems.length.toLocaleString()} clauses indexed.`);
}

// ── App: filter & search ───────────────────────────────────────────────────────

function apply_doc_filter(filter) {
  activeDocFilter = filter;
  [els.filterAll, els.filterSyabas, els.filterSpan].forEach((btn) => {
    if (btn) btn.classList.toggle("active", btn.dataset.filter === filter);
  });

  if (filter === "all") {
    filteredItems = allItems;
  } else {
    filteredItems = allItems.filter((it) => it.doc_type === filter);
  }

  const query = els.searchInput.value.trim();
  if (query) {
    do_search(query);
  } else {
    ResultsUI.close();
    els.resultsList.innerHTML = "";
  }
}

async function do_search(query) {
  if (!sqlDb) return;
  if (!query || !query.trim()) {
    ResultsUI.close();
    els.resultsList.innerHTML = "";
    return;
  }

  set_status("Searching…", true);
  try {
    const results = SearchPort.search(filteredItems, query, CONFIG.SEARCH_LIMIT);
    if (results.length > 0) {
      ResultsUI.render(results);
      set_status(`${results.length} keputusan untuk "${query}"`);
      return;
    }

    const fuzzy = fuzzy_search(filteredItems, query, CONFIG.SEARCH_LIMIT, CONFIG.FUZZY_MIN_SIM);
    ResultsUI.render(fuzzy);
    set_status(fuzzy.length
      ? `Padanan terdekat — ${fuzzy.length} untuk "${query}"`
      : `Tiada keputusan untuk "${query}"`
    );
  } catch (e) {
    console.error("Search error:", e);
    set_status("Ralat carian — cuba terma lain.");
  }
}

// ── App: boot ──────────────────────────────────────────────────────────────────

function init_event_listeners() {
  els.searchInput.addEventListener("input", (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(
      () => do_search(e.target.value),
      CONFIG.SEARCH_DEBOUNCE_MS
    );
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== els.searchInput) {
      e.preventDefault();
      els.searchInput.focus();
    }
  });

  const darkToggle = document.getElementById("dark-toggle");
  if (darkToggle) {
    darkToggle.addEventListener("click", () => {
      const dark = !document.documentElement.classList.contains("dark");
      document.documentElement.classList.toggle("dark", dark);
      localStorage.setItem("air-selangor-dark", dark ? "1" : "0");
    });
  }

  [els.filterAll, els.filterSyabas, els.filterSpan].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener("click", () => apply_doc_filter(btn.dataset.filter));
  });
}

async function init_app() {
  init_event_listeners();
  try {
    await init_database();
  } catch (e) {
    console.error("App init failed:", e);
    set_status("Gagal memuatkan pangkalan data. Muat semula untuk cuba lagi.");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init_app);
} else {
  init_app();
}
