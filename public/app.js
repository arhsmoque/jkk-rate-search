/**
 * JKK Rate Search — PWA
 * Core / Port / Adapter / App structure per AODP
 */

// ── Core: invariant domain logic ──────────────────────────────────────────────

function format_search_result_row(row) {
  return {
    id:             row.id,
    item_no:        row.item_no        || "—",
    description:    row.description    || "",
    unit:           row.unit           || "",
    doc_type:       row.doc_type       || "",
    edition_year:   row.edition_year   || 0,
    source_page:    row.source_page    || 0,
    rate_count:     row.rate_count     || 0,
    variant_labels: row.variant_labels || "",
  };
}

// ── Core: fuzzy fallback (typo tolerance) ─────────────────────────────────────
//
// FTS5 only does prefix matching, so a typo like "konkret" (for "konkrit") or
// "scafold" (for "scaffold") returns zero rows. When the exact/prefix search
// finds nothing, we fall back to an in-memory fuzzy scan over all items using
// bounded Levenshtein distance. The dataset is small (~2.4k items) so this runs
// well under a frame even on mobile, and only triggers on an exact-miss.

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

function load_all_items(db) {
  const sql = `
    SELECT i.id, i.item_no, i.description, i.unit, i.doc_type,
           i.edition_year, i.source_page, COUNT(r.id) AS rate_count,
           GROUP_CONCAT(r.variant_label, '|') AS variant_labels
    FROM jkk_items i
    LEFT JOIN jkk_rates r ON r.item_id = i.id
    GROUP BY i.id
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
      rate_count:     v[idx.rate_count]     || 0,
      variant_labels: v[idx.variant_labels] || "",
    };
    row._tokens = fuzzy_tokenize(
      `${row.item_no} ${row.description} ${row.unit} ${row.variant_labels.replace(/\|/g, " ")}`
    );
    return row;
  });
}

// ── Ports: stable interface contracts ─────────────────────────────────────────

const SearchPort = {
  search(items, query, limit = 20) {
    return prefix_search(items, query, limit);
  },

  async get_item_detail(db, item_id) {
    const item_stmt = db.prepare("SELECT * FROM jkk_items WHERE id = ?");
    item_stmt.bind([String(item_id)]);
    let item = null;
    if (item_stmt.step()) item = item_stmt.getAsObject();
    item_stmt.free();

    const rates_stmt = db.prepare(
      "SELECT variant_label, variant_type, rate_rm FROM jkk_rates WHERE item_id = ? ORDER BY id"
    );
    rates_stmt.bind([String(item_id)]);
    const rates = [];
    while (rates_stmt.step()) rates.push(rates_stmt.getAsObject());
    rates_stmt.free();

    return { item, rates };
  },
};

const StoragePort = {
  async load_database()          { return IndexedDbStorageAdapter.load_database(); },
  async persist_database(bytes)  { return IndexedDbStorageAdapter.persist_database(bytes); },
};

// ── Adapters: runtime-specific bindings ───────────────────────────────────────

const IndexedDbStorageAdapter = {
  DB_NAME:    "jkk-rate-search-db",
  STORE_NAME: "db-blobs",
  KEY:        "jkk-master-v1",

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

// ── App: CONFIG — script-patchable via scripts/patch-config.ps1 ───────────────

const CONFIG = {
  SEARCH_LIMIT:       20,
  FUZZY_MIN_SIM:      0.6,
  SEARCH_DEBOUNCE_MS: 150,
  LOCALE:             "en-MY",
  DOC_LABELS:         { civil: "Civil", electrical: "Electrical", pukal: "Pukal" },
  DB_PATH:            "assets/jkk-master.db",
}; // END CONFIG

// ── App: RATE_TABLE_COLS — script-patchable via scripts/patch-columns.ps1 ─────
//
// Add, remove, or reorder columns here. Each entry drives both <th> and <td>.
// type: "text" | "badge" | "currency"
// The column with type "currency" gets the unit appended to its header label.

const RATE_TABLE_COLS = [
  { key: "variant_label", label: "Varian", align: "left",  type: "text"     },
  { key: "variant_type",  label: "Jenis",  align: "left",  type: "badge"    },
  { key: "rate_rm",       label: "Kadar",  align: "right", type: "currency" },
]; // END RATE_TABLE_COLS

// ── App: utilities ─────────────────────────────────────────────────────────────

function escape_html(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function format_currency(value) {
  if (value === null || value === undefined) return "—";
  return "RM " + Number(value).toLocaleString(CONFIG.LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function doc_label(doc_type, year) {
  const name = CONFIG.DOC_LABELS[doc_type] || doc_type;
  return year ? `${name} ${year}` : name;
}

// ── App: DOM refs & status ─────────────────────────────────────────────────────

const els = {
  searchInput: document.getElementById("search-input"),
  resultsList: document.getElementById("results-list"),
  statusBar:   document.getElementById("status-bar"),
  statusText:  document.getElementById("status-text"),
};

function set_status(msg, loading = false) {
  els.statusText.textContent = msg;
  els.statusBar.classList.toggle("loading", loading);
}

// ── App: mutable search state ──────────────────────────────────────────────────

let sqlDb = null;
let allItems = [];
let searchDebounceTimer = null;

// ── App: ResultsUI ─────────────────────────────────────────────────────────────
//
// Single owner of all result-list and inline-detail state.
// Nothing outside this object reads or writes _activeId / _activeDetailEl.
// Callers use: ResultsUI.render(results), ResultsUI.open(id, li), ResultsUI.close()

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
        `<li class="empty-state">Tiada item dijumpai. Cuba kata kunci lain.</li>`;
      return;
    }

    for (const r of results) {
      const li = document.createElement("li");
      li.className = "result-item";
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.dataset.id = r.id;

      const rateLabel = r.rate_count > 1 ? `${r.rate_count} kadar`
                      : r.rate_count === 1 ? "1 kadar" : "";
      const variantPills = r.variant_labels
        ? r.variant_labels.split("|").filter(Boolean)
        : [];

      li.innerHTML = `
        <div class="row-top">
          <span class="code">${escape_html(r.item_no)}</span>
          <span class="desc">${escape_html(r.description)}</span>
        </div>
        ${variantPills.length
          ? `<div class="variant-pills">${
              variantPills.map(v => `<span class="vpill">${escape_html(v)}</span>`).join("")
            }</div>`
          : ""}
        <div class="meta">
          ${r.unit     ? `<span>${escape_html(r.unit)}</span>`                         : ""}
          ${rateLabel  ? `<span>• ${rateLabel}</span>`                                 : ""}
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
    if (this._activeId === item_id) { this.close(); return; }  // toggle
    this.close();
    this._activeId = item_id;
    targetLi.classList.add("active");
    set_status("Memuatkan…", true);
    try {
      const { item, rates } = await SearchPort.get_item_detail(sqlDb, item_id);
      if (!item) { set_status("Item tidak dijumpai."); return; }
      this._render_detail(item, rates, targetLi);
      set_status("Siap.");
    } catch (e) {
      console.error("Detail error:", e);
      set_status("Gagal memuatkan butiran.");
    }
  },

  _render_detail(item, rates, targetLi) {
    const unitLabel = item.unit ? escape_html(item.unit) : "";

    // Build table header from RATE_TABLE_COLS
    const thead = RATE_TABLE_COLS.map(col => {
      const label = (col.type === "currency" && unitLabel)
        ? `${col.label} (RM / ${unitLabel})`
        : col.label;
      return `<th style="text-align:${col.align}">${label}</th>`;
    }).join("");

    // Build table rows from RATE_TABLE_COLS
    const tbody = rates.map(r => {
      const cells = RATE_TABLE_COLS.map(col => {
        let val;
        if (col.type === "currency") {
          val = format_currency(r[col.key]);
        } else if (col.type === "badge") {
          val = r[col.key]
            ? `<span class="variant-type-badge">${escape_html(r[col.key])}</span>`
            : `<span class="muted-dash">—</span>`;
        } else {
          val = escape_html(r[col.key]);
        }
        return `<td style="text-align:${col.align}">${val}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("");

    const ratesHtml = rates.length
      ? `<table class="rates-table">
           <thead><tr>${thead}</tr></thead>
           <tbody>${tbody}</tbody>
         </table>`
      : `<p class="no-rates">Tiada data kadar.</p>`;

    const sectionHtml = item.section
      ? `<div class="detail-section">${escape_html(item.section)}</div>` : "";
    const remarksHtml = item.remarks
      ? `<div class="detail-remarks"><strong>Nota:</strong> ${escape_html(item.remarks)}</div>`
      : "";

    const detailEl = document.createElement("li");
    detailEl.className = "detail-inline";
    detailEl.innerHTML = `
      <div class="detail-header">
        <div>
          <div class="detail-code">${escape_html(item.item_no || "—")}</div>
          <div class="detail-meta">
            ${escape_html(doc_label(item.doc_type, item.edition_year))}
            ${item.source_page ? `• Muka surat ${item.source_page}` : ""}
            ${unitLabel        ? `• Unit: ${unitLabel}`             : ""}
          </div>
        </div>
        <button class="close-btn" aria-label="Tutup butiran">&times;</button>
      </div>
      ${sectionHtml}
      <div class="detail-desc">${escape_html(item.description)}</div>
      ${remarksHtml}
      ${ratesHtml}
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
    set_status("Downloading database (≈1 MB)…", true);
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
  set_status(`Ready — ${allItems.length.toLocaleString()} items indexed.`);
}

// ── App: search orchestration ──────────────────────────────────────────────────

async function do_search(query) {
  if (!sqlDb) return;
  if (!query || !query.trim()) {
    ResultsUI.close();
    els.resultsList.innerHTML = "";
    return;
  }

  set_status("Searching…", true);
  try {
    const results = SearchPort.search(allItems, query, CONFIG.SEARCH_LIMIT);
    if (results.length > 0) {
      ResultsUI.render(results);
      set_status(`${results.length} keputusan untuk "${query}"`);
      return;
    }

    // No exact/prefix hit — fall back to typo-tolerant fuzzy matching.
    const fuzzy = fuzzy_search(allItems, query, CONFIG.SEARCH_LIMIT, CONFIG.FUZZY_MIN_SIM);
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

  // "/" focuses search from anywhere
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== els.searchInput) {
      e.preventDefault();
      els.searchInput.focus();
    }
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
