/**
 * JKK Rate Search — PWA
 * Core / Port / Adapter structure per AODP
 */

// ── Core: invariant domain logic ──────────────────────────────────────────────

/**
 * Sanitize raw user input for FTS5 MATCH.
 * @param {string} raw_query
 * @returns {string|null}
 */
function normalize_search_input(raw_query) {
  const cleaned = (raw_query || "")
    .trim()
    .replace(/["'\(\)\[\]\{\}\*\?\:]/g, "");
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return null;
  // Prefix match each token for instant dropdown feel
  return words.map(w => w + "*").join(" ");
}

/**
 * Build the FTS5 search SQL and parameters.
 * @param {string} normalized_query
 * @param {number} limit
 * @returns {{sql: string, params: Array<string|number>}}
 */
function build_search_query(normalized_query, limit = 20) {
  const sql = `
    SELECT
      i.id,
      i.item_no,
      i.description,
      i.unit,
      i.doc_type,
      i.edition_year,
      i.source_page,
      COUNT(r.id) AS rate_count
    FROM jkk_items_fts fts
    JOIN jkk_items i ON i.id = fts.rowid
    LEFT JOIN jkk_rates r ON r.item_id = i.id
    WHERE jkk_items_fts MATCH ?
    GROUP BY i.id
    ORDER BY rank
    LIMIT ?
  `;
  return { sql, params: [normalized_query, limit] };
}

/**
 * Map raw DB row to display-friendly object.
 * @param {object} row
 * @returns {object}
 */
function format_search_result_row(row) {
  return {
    id: row.id,
    item_no: row.item_no || "—",
    description: row.description || "",
    unit: row.unit || "",
    doc_type: row.doc_type || "",
    edition_year: row.edition_year || 0,
    source_page: row.source_page || 0,
    rate_count: row.rate_count || 0,
  };
}

// ── Ports: stable interface contracts ─────────────────────────────────────────

const SearchPort = {
  /**
   * Execute a search against the database.
   * @param {SQL.Database} db
   * @param {string} query
   * @param {number} limit
   * @returns {Promise<object[]>}
   */
  async search(db, query, limit = 20) {
    const norm = normalize_search_input(query);
    if (!norm) return [];
    const { sql, params } = build_search_query(norm, limit);
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(format_search_result_row(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  },

  /**
   * Fetch full item detail with rates.
   * @param {SQL.Database} db
   * @param {number} item_id
   * @returns {Promise<{item: object|null, rates: object[]}>}
   */
  async get_item_detail(db, item_id) {
    const item_stmt = db.prepare("SELECT * FROM jkk_items WHERE id = ?");
    item_stmt.bind([String(item_id)]);
    let item = null;
    if (item_stmt.step()) {
      item = item_stmt.getAsObject();
    }
    item_stmt.free();

    const rates_stmt = db.prepare(
      "SELECT variant_label, rate_rm FROM jkk_rates WHERE item_id = ? ORDER BY id"
    );
    rates_stmt.bind([String(item_id)]);
    const rates = [];
    while (rates_stmt.step()) {
      rates.push(rates_stmt.getAsObject());
    }
    rates_stmt.free();

    return { item, rates };
  },
};

const StoragePort = {
  /**
   * Load the database bytes from local persistence.
   * @returns {Promise<Uint8Array|null>}
   */
  async load_database() {
    return IndexedDbStorageAdapter.load_database();
  },

  /**
   * Persist database bytes locally.
   * @param {Uint8Array} bytes
   * @returns {Promise<void>}
   */
  async persist_database(bytes) {
    return IndexedDbStorageAdapter.persist_database(bytes);
  },
};

// ── Adapters: runtime-specific bindings ───────────────────────────────────────

const IndexedDbStorageAdapter = {
  DB_NAME: "jkk-rate-search-db",
  STORE_NAME: "db-blobs",
  KEY: "jkk-master-v1",

  async load_database() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        e.target.result.createObjectStore(this.STORE_NAME);
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction(this.STORE_NAME, "readonly");
        const store = tx.objectStore(this.STORE_NAME);
        const getReq = store.get(this.KEY);
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => reject(getReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async persist_database(bytes) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        e.target.result.createObjectStore(this.STORE_NAME);
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction(this.STORE_NAME, "readwrite");
        const store = tx.objectStore(this.STORE_NAME);
        const putReq = store.put(bytes, this.KEY);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  },
};

const SqlJsAdapter = {
  /** @type {object|null} */
  SQL: null,

  async init() {
    if (this.SQL) return this.SQL;
    this.SQL = await initSqlJs({
      locateFile: (file) => `vendor/${file}`,
    });
    return this.SQL;
  },

  load_database(bytes) {
    return new this.SQL.Database(bytes);
  },
};

// ── App: DOM wiring ───────────────────────────────────────────────────────────

let sqlDb = null;
let searchDebounceTimer = null;
let currentDetailId = null;

const els = {
  searchInput: document.getElementById("search-input"),
  resultsList: document.getElementById("results-list"),
  detailPanel: document.getElementById("detail-panel"),
  statusBar: document.getElementById("status-bar"),
  statusText: document.getElementById("status-text"),
};

function set_status(msg, loading = false) {
  els.statusText.textContent = msg;
  if (loading) {
    els.statusBar.classList.add("loading");
  } else {
    els.statusBar.classList.remove("loading");
  }
}

function format_currency(value) {
  if (value === null || value === undefined) return "—";
  return "RM " + Number(value).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function doc_label(doc_type, year) {
  const labels = { civil: "Civil", electrical: "Electrical", pukal: "Pukal" };
  const name = labels[doc_type] || doc_type;
  return year ? `${name} ${year}` : name;
}

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
    const resp = await fetch("assets/jkk-master.db");
    if (!resp.ok) throw new Error("Failed to fetch database: " + resp.status);
    const arrayBuffer = await resp.arrayBuffer();
    bytes = new Uint8Array(arrayBuffer);
    try {
      await StoragePort.persist_database(bytes);
    } catch (e) {
      console.warn("IndexedDB write failed (private browsing?):", e);
    }
  }

  set_status("Loading SQL engine…", true);
  await SqlJsAdapter.init();
  sqlDb = SqlJsAdapter.load_database(bytes);
  const itemCount = sqlDb.exec("SELECT COUNT(*) FROM jkk_items")[0]?.values[0]?.[0] || 0;
  set_status(`Ready — ${itemCount.toLocaleString()} items indexed.`);
}

async function do_search(query) {
  if (!sqlDb) return;
  if (!query || query.trim().length === 0) {
    els.resultsList.innerHTML = "";
    els.detailPanel.innerHTML = "";
    currentDetailId = null;
    return;
  }

  set_status("Searching…", true);
  try {
    const results = await SearchPort.search(sqlDb, query, 20);
    render_results(results);
    set_status(`${results.length} result${results.length === 1 ? "" : "s"} for "${query}"`);
  } catch (e) {
    console.error("Search error:", e);
    set_status("Search error — try a different term.");
  }
}

function render_results(results) {
  els.resultsList.innerHTML = "";
  els.detailPanel.innerHTML = "";
  currentDetailId = null;

  if (results.length === 0) {
    els.resultsList.innerHTML = `<li class="empty-state">No items found. Try another keyword.</li>`;
    return;
  }

  for (const r of results) {
    const li = document.createElement("li");
    li.className = "result-item";
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");
    li.dataset.id = r.id;

    const rateLabel = r.rate_count > 1 ? `${r.rate_count} rates` : (r.rate_count === 1 ? "1 rate" : "");

    li.innerHTML = `
      <div class="row-top">
        <span class="code">${escape_html(r.item_no)}</span>
        <span class="desc">${escape_html(r.description)}</span>
      </div>
      <div class="meta">
        ${r.unit ? `<span>${escape_html(r.unit)}</span>` : ""}
        ${rateLabel ? `<span>• ${rateLabel}</span>` : ""}
        <span class="badge">${escape_html(doc_label(r.doc_type, r.edition_year))}</span>
      </div>
    `;

    li.addEventListener("click", () => show_detail(r.id));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") show_detail(r.id);
    });
    els.resultsList.appendChild(li);
  }
}

async function show_detail(item_id) {
  if (!sqlDb) return;
  currentDetailId = item_id;
  set_status("Loading detail…", true);
  try {
    const { item, rates } = await SearchPort.get_item_detail(sqlDb, item_id);
    if (!item) {
      set_status("Item not found.");
      return;
    }
    render_detail(item, rates);
    set_status("Detail loaded.");
  } catch (e) {
    console.error("Detail error:", e);
    set_status("Failed to load detail.");
  }
}

function render_detail(item, rates) {
  const ratesHtml = rates.length
    ? `<table class="rates-table">
        <thead><tr><th>Variant</th><th>Rate</th></tr></thead>
        <tbody>
          ${rates.map(r => `
            <tr>
              <td>${escape_html(r.variant_label)}</td>
              <td>${format_currency(r.rate_rm)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>`
    : `<p style="color:var(--muted);font-size:0.85rem;">No rate data available.</p>`;

  els.detailPanel.innerHTML = `
    <div class="detail-header">
      <div>
        <div class="detail-code">${escape_html(item.item_no || "—")}</div>
        <div class="detail-meta">
          ${escape_html(doc_label(item.doc_type, item.edition_year))}
          ${item.source_page ? `• Page ${item.source_page}` : ""}
          ${item.unit ? `• Unit: ${escape_html(item.unit)}` : ""}
        </div>
      </div>
      <button class="close-btn" aria-label="Close detail">&times;</button>
    </div>
    <div class="detail-desc">${escape_html(item.description)}</div>
    ${ratesHtml}
  `;

  els.detailPanel.querySelector(".close-btn").addEventListener("click", () => {
    els.detailPanel.innerHTML = "";
    currentDetailId = null;
  });

  els.detailPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function escape_html(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function init_event_listeners() {
  els.searchInput.addEventListener("input", (e) => {
    const query = e.target.value;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => do_search(query), 150);
  });

  // Keyboard shortcut: / to focus search
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
    set_status("Failed to load database. Refresh to retry.");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init_app);
} else {
  init_app();
}
