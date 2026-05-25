(() => {
  "use strict";

  const Config = {
    VERSION: "250526b1",
    APP: "FPContentManager",
    API_URL: "https://graph.facebook.com/v23.0/",
    CACHE_KEY: "fpcontentmanager.lastPackage.v1",
  };
  const APP_ID = "ywbFPContentManager";
  const APP_TITLE = "FP Content Manager";
  const APP_MARK_SVG = `<svg class="ywb-mark" viewBox="0 0 96 96" aria-hidden="true"><defs><linearGradient id="${APP_ID}-gold" x1="0%" x2="100%" y1="0%" y2="100%"><stop offset="0%" stop-color="#ffe16a"/><stop offset="55%" stop-color="#ffd000"/><stop offset="100%" stop-color="#ffab00"/></linearGradient></defs><rect x="4" y="4" width="88" height="88" rx="22" fill="#151515" stroke="url(#${APP_ID}-gold)" stroke-width="6"/><path d="M28 24h40v48H28z" fill="#222" stroke="#fff2bd" stroke-width="4"/><path d="M36 36h24M36 47h18M36 58h24" stroke="url(#${APP_ID}-gold)" stroke-width="5" stroke-linecap="round"/><circle cx="66" cy="30" r="8" fill="url(#${APP_ID}-gold)"/></svg>`;

  if (window.__FPContentManagerPayloadBuild === Config.VERSION && typeof window.showFPContentManager === "function") {
    window.showFPContentManager();
    return;
  }
  window.__FPContentManagerPayloadBuild = Config.VERSION;

  const state = { pages: [], package: null, logs: [] };

  function runtimeToken() {
    if (window.__accessToken) return window.__accessToken;
    for (const entry of performance.getEntriesByType("resource").map((item) => item.name || "")) {
      if (!entry.includes("access_token=")) continue;
      try {
        const token = new URL(entry).searchParams.get("access_token");
        if (token) return token;
      } catch (error) {
        // Ignore.
      }
    }
    return "";
  }

  function tokenInput() {
    return document.querySelector("#ywbFPContentToken")?.value.trim() || runtimeToken();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function log(message, type = "info") {
    const item = { ts: new Date().toISOString(), type, message };
    state.logs.push(item);
    if (state.logs.length > 300) state.logs.shift();
    const box = document.querySelector("#ywbFPContentLog");
    if (box) {
      const row = document.createElement("div");
      row.className = `ywb-log-row ${type}`;
      row.textContent = `[${item.ts.slice(11, 19)}] ${message}`;
      box.appendChild(row);
      box.scrollTop = box.scrollHeight;
    }
    (type === "error" ? console.error : console.log)(`[${Config.APP}] ${message}`);
  }

  function downloadJson(fileName, data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function readJsonFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(JSON.parse(reader.result)); } catch (error) { reject(error); }
      };
      reader.onerror = () => reject(new Error("Cannot read selected file."));
      reader.readAsText(file);
    });
  }

  class GraphApi {
    constructor(token) {
      this.token = token || tokenInput();
      if (!this.token) throw new Error("Facebook access token is required. Use a user token or page token with page permissions.");
    }

    url(path, params = {}) {
      const finalUrl = path.startsWith("http") ? new URL(path) : new URL(path.replace(/^\/+/, ""), Config.API_URL);
      if (!finalUrl.searchParams.has("access_token")) finalUrl.searchParams.set("access_token", this.token);
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") finalUrl.searchParams.set(key, String(value));
      });
      return finalUrl.toString();
    }

    async request(path, params = {}, init = {}) {
      const response = await fetch(this.url(path, params), { credentials: "include", cache: "no-store", ...init });
      const text = await response.text();
      let json = {};
      try { json = text ? JSON.parse(text.replace(/^for\s*\(;;\);\s*/, "")) : {}; } catch (error) {
        throw new Error(`Graph response is not JSON: ${text.slice(0, 180)}`);
      }
      if (!response.ok || json.error) throw new Error(json.error?.message || `${response.status} ${text.slice(0, 180)}`);
      return json;
    }

    get(path, params = {}) { return this.request(path, params); }

    post(path, body = {}) {
      const form = new URLSearchParams();
      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined && value !== null) form.set(key, String(value));
      });
      return this.request(path, {}, { method: "POST", body: form });
    }

    delete(path) { return this.request(path, {}, { method: "DELETE" }); }

    async getAll(path, params = {}) {
      let url = this.url(path, params);
      const items = [];
      while (url) {
        const page = await this.request(url);
        if (Array.isArray(page.data)) items.push(...page.data);
        url = page.paging?.next || "";
      }
      return items;
    }
  }

  async function fetchPages() {
    const api = new GraphApi(tokenInput());
    log("Fetching pages from me/accounts...");
    const pages = await api.getAll("me/accounts", {
      fields: "id,name,access_token,picture.type(large)",
      limit: 250,
    });
    state.pages = pages.map((page) => ({
      id: page.id,
      name: page.name || page.id,
      access_token: page.access_token || tokenInput(),
      avatar: page.picture?.data?.url || "",
    }));
    renderPages();
    log(`Loaded ${state.pages.length} page(s).`, "success");
    return state.pages;
  }

  function selectedPage() {
    const id = document.querySelector("#ywbFPContentPage")?.value || "";
    const page = state.pages.find((item) => item.id === id);
    if (page) return page;
    const manualId = document.querySelector("#ywbFPContentManualPage")?.value.trim() || "";
    if (!manualId) throw new Error("Select a page or enter page ID.");
    return { id: manualId, name: manualId, access_token: tokenInput() };
  }

  async function exportContent(page = selectedPage()) {
    const api = new GraphApi(page.access_token || tokenInput());
    log(`Exporting content for ${page.name} (${page.id})...`);
    const posts = await api.getAll(`${page.id}/posts`, {
      fields: "id,message,created_time,permalink_url,attachments{media_type,title,url,description}",
      limit: 100,
    });
    const photos = await api.getAll(`${page.id}/photos`, {
      type: "uploaded",
      fields: "id,name,created_time,link,picture,images",
      limit: 100,
    });
    const videos = await api.getAll(`${page.id}/videos`, {
      fields: "id,title,description,created_time,permalink_url",
      limit: 100,
    });
    const pack = {
      app: Config.APP,
      version: Config.VERSION,
      exportedAt: new Date().toISOString(),
      page: { id: page.id, name: page.name || page.id },
      posts,
      photos,
      videos,
    };
    state.package = pack;
    localStorage.setItem(Config.CACHE_KEY, JSON.stringify(pack));
    downloadJson(`fpcontent_${page.id}_${new Date().toISOString().slice(0, 10)}.json`, pack);
    updatePackageInfo();
    log(`Exported ${posts.length} post(s), ${photos.length} photo(s), ${videos.length} video(s).`, "success");
    return pack;
  }

  async function importContent(page = selectedPage(), pack = state.package) {
    if (!pack?.posts?.length) throw new Error("Import package has no posts. Media metadata is export-only in this browser tool.");
    const api = new GraphApi(page.access_token || tokenInput());
    const limit = Number(document.querySelector("#ywbFPContentImportLimit")?.value || 0) || pack.posts.length;
    const posts = pack.posts.slice(0, Math.max(0, limit));
    let ok = 0;
    for (const post of posts) {
      const message = String(post.message || "").trim();
      if (!message) {
        log(`Skipping post ${post.id || ""}: empty message.`, "warning");
        continue;
      }
      try {
        await api.post(`${page.id}/feed`, { message });
        ok += 1;
        log(`Imported text post ${ok}/${posts.length}.`, "success");
      } catch (error) {
        log(`Failed to import post ${post.id || ""}: ${error.message}`, "error");
      }
    }
    log(`Import finished: ${ok}/${posts.length} text post(s).`, ok === posts.length ? "success" : "warning");
    return { imported: ok, total: posts.length };
  }

  async function deleteEdgeItems(api, edge, label) {
    const items = await api.getAll(edge, { fields: "id", limit: 100 });
    let deleted = 0;
    for (const item of items) {
      try {
        await api.delete(item.id);
        deleted += 1;
        log(`Deleted ${label} ${item.id}.`, "success");
      } catch (error) {
        log(`Failed to delete ${label} ${item.id}: ${error.message}`, "error");
      }
    }
    return { found: items.length, deleted };
  }

  async function cleanContent(page = selectedPage()) {
    const confirmText = document.querySelector("#ywbFPContentConfirm")?.value.trim() || "";
    if (confirmText !== page.id) {
      throw new Error("To clean content, type the selected page ID into the confirmation field.");
    }
    const api = new GraphApi(page.access_token || tokenInput());
    log(`Cleaning content for ${page.name} (${page.id})...`, "warning");
    const posts = await deleteEdgeItems(api, `${page.id}/posts`, "post");
    const photos = await deleteEdgeItems(api, `${page.id}/photos?type=uploaded`, "photo");
    const videos = await deleteEdgeItems(api, `${page.id}/videos`, "video");
    log(`Cleanup finished: posts ${posts.deleted}/${posts.found}, photos ${photos.deleted}/${photos.found}, videos ${videos.deleted}/${videos.found}.`, "success");
    return { posts, photos, videos };
  }

  function updatePackageInfo() {
    const el = document.querySelector("#ywbFPContentPackageInfo");
    if (!el) return;
    const pack = state.package;
    el.textContent = pack
      ? `${pack.posts?.length || 0} post(s), ${pack.photos?.length || 0} photo(s), ${pack.videos?.length || 0} video(s) loaded from ${pack.page?.name || pack.page?.id || "package"}`
      : "No package loaded.";
  }

  function renderPages() {
    const select = document.querySelector("#ywbFPContentPage");
    if (!select) return;
    select.innerHTML = `<option value="">Select fetched page</option>` + state.pages
      .map((page) => `<option value="${escapeHtml(page.id)}">${escapeHtml(page.name)} (${escapeHtml(page.id)})</option>`)
      .join("");
  }

  function createUi() {
    document.querySelector("#ywbFPContentManager")?.remove();
    const root = document.createElement("div");
    root.id = "ywbFPContentManager";
    root.innerHTML = `
      <style>
        #ywbFPContentManager{position:fixed;inset:18px;z-index:2147483647;pointer-events:none;font:14px/1.45 "Segoe UI","Trebuchet MS",sans-serif;color:#f5f5f5}
        #ywbFPContentManager *{box-sizing:border-box}
        #ywbFPContentManager .ywb-shell{position:relative;width:min(720px,calc(100vw - 36px));max-height:calc(100vh - 36px);margin:0 auto;background:#1a1a1a;border:2px solid #ffc107;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.7);padding:18px;overflow:auto;pointer-events:auto}
        .ywb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:14px}.ywb-title-row{display:inline-flex;align-items:center;gap:10px}.ywb-mark{width:34px;height:34px;display:block;flex:0 0 auto;filter:drop-shadow(0 6px 14px rgba(255,193,7,.18))}
        .ywb-head h2{margin:0;color:#ffc107;font-size:22px;line-height:1.1;letter-spacing:.02em}.ywb-build{font-size:12px;font-weight:600;color:#aaa;vertical-align:middle;margin-left:4px}.ywb-byline{display:block;font-size:12px;color:#ffc107;text-decoration:none;opacity:.7;margin-top:2px}.ywb-byline:hover{opacity:1;text-decoration:underline}
        .ywb-close{border:1px solid #ffc107;background:#2a2a2a;color:#ffc107;width:34px;height:34px;border-radius:6px;font-weight:900;cursor:pointer}.ywb-close:hover{background:#ffc107;color:#111}
        .ywb-body{display:grid;gap:14px}.ywb-section{display:grid;gap:12px;border:1px solid #333;background:#202020;border-radius:8px;padding:12px}.ywb-section-title{margin:0;color:#ffc107;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
        .ywb-field{display:grid;gap:5px}.ywb-field span{color:#aaa;font-size:12px}.ywb-field input,.ywb-field select{width:100%;border:1px solid #555;border-radius:6px;background:#2a2a2a;color:#f5f5f5;padding:10px 12px;font-size:14px}.ywb-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .ywb-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.ywb-row button,.ywb-file{border:1px solid #ffc107;background:#ffc107;color:#111;border-radius:6px;padding:10px 12px;font-weight:800;cursor:pointer}.ywb-row button.secondary,.ywb-file.secondary{background:#2a2a2a;color:#ffc107}.ywb-row button.danger{border-color:#ff6b6b;color:#ffb3b3;background:#3a1111}.ywb-row button:hover:not(:disabled),.ywb-file:hover{filter:brightness(1.08)}
        .ywb-note{color:#aaa;font-size:12px}#ywbFPContentLog{height:150px;overflow:auto;border:1px solid #444;background:#111;color:#ccc;border-radius:6px;padding:8px;font:11px/1.4 Consolas,"Courier New",monospace;white-space:pre-wrap}.ywb-log-row.success{color:#9ef59e}.ywb-log-row.error{color:#ff9e9e}.ywb-log-row.warning{color:#ffd86b}
        @media(max-width:720px){#ywbFPContentManager{inset:10px}.ywb-shell{width:calc(100vw - 20px)}.ywb-grid{grid-template-columns:1fr}.ywb-row{flex-direction:column;align-items:stretch}.ywb-row button,.ywb-file{width:100%}}
      </style>
      <div class="ywb-shell">
        <div class="ywb-head">
          <div>
            <div class="ywb-title-row">${APP_MARK_SVG}<h2>${APP_TITLE} <span class="ywb-build">build ${escapeHtml(Config.VERSION)}</span></h2></div>
            <a class="ywb-byline" href="https://yellowweb.top" target="_blank" rel="noopener">by Yellow Web</a>
          </div>
          <button class="ywb-close" title="Close">&#x2715;</button>
        </div>
        <div class="ywb-body">
          <section class="ywb-section">
            <p class="ywb-section-title">Page</p>
            <label class="ywb-field"><span>User or page access token</span><input id="ywbFPContentToken" placeholder="uses page runtime token if empty"></label>
            <div class="ywb-row"><button class="primary" id="ywbFPContentFetch">Fetch pages</button></div>
            <div class="ywb-grid">
              <label class="ywb-field"><span>Fetched page</span><select id="ywbFPContentPage"><option value="">Select fetched page</option></select></label>
              <label class="ywb-field"><span>Manual page ID</span><input id="ywbFPContentManualPage" placeholder="optional"></label>
            </div>
          </section>
          <section class="ywb-section">
            <p class="ywb-section-title">Export / import</p>
            <div class="ywb-row">
              <button class="primary" id="ywbFPContentExport">Export content</button>
              <label class="ywb-file secondary">Import JSON<input id="ywbFPContentFile" type="file" accept=".json,application/json" hidden></label>
              <button id="ywbFPContentImport">Import text posts</button>
              <label class="ywb-field" style="width:120px"><span>Import limit</span><input id="ywbFPContentImportLimit" type="number" min="1" placeholder="all"></label>
            </div>
            <div id="ywbFPContentPackageInfo" class="ywb-note">No package loaded.</div>
          </section>
          <section class="ywb-section">
            <p class="ywb-section-title">Cleanup</p>
            <div class="ywb-grid">
              <label class="ywb-field"><span>Type selected page ID to confirm cleanup</span><input id="ywbFPContentConfirm" placeholder="page id"></label>
              <div class="ywb-row" style="align-self:end"><button class="danger" id="ywbFPContentClean">Clean posts/photos/videos</button></div>
            </div>
          </section>
          <div id="ywbFPContentLog"></div>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.querySelector(".ywb-close").onclick = () => root.remove();
    root.querySelector("#ywbFPContentFetch").onclick = () => fetchPages().catch((error) => log(error.message, "error"));
    root.querySelector("#ywbFPContentExport").onclick = () => exportContent().catch((error) => log(error.message, "error"));
    root.querySelector("#ywbFPContentImport").onclick = () => importContent().catch((error) => log(error.message, "error"));
    root.querySelector("#ywbFPContentClean").onclick = () => cleanContent().catch((error) => log(error.message, "error"));
    root.querySelector("#ywbFPContentFile").onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        state.package = await readJsonFile(file);
        localStorage.setItem(Config.CACHE_KEY, JSON.stringify(state.package));
        updatePackageInfo();
        log(`Loaded package from ${file.name}.`, "success");
      } catch (error) {
        log(`Cannot load package: ${error.message}`, "error");
      }
    };
    try {
      const cached = JSON.parse(localStorage.getItem(Config.CACHE_KEY) || "null");
      if (cached?.posts || cached?.photos || cached?.videos) state.package = cached;
    } catch (error) {
      // Ignore malformed cache.
    }
    updatePackageInfo();
    log("Ready.");
  }

  window.showFPContentManager = async () => createUi();
  window.FPContentManager = {
    Config,
    state,
    fetchPages,
    exportContent,
    importContent,
    cleanContent,
    debug: { runtimeToken },
  };

  createUi();
})();
