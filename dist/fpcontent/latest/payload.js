(() => {
  "use strict";

  const Config = {
    VERSION: "200526b1",
    APP: "FPContentManager",
    API_URL: "https://graph.facebook.com/v23.0/",
    CACHE_KEY: "fpcontentmanager.lastPackage.v1",
  };

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
      .map((page) => `<option value="${page.id}">${page.name} (${page.id})</option>`)
      .join("");
  }

  function createUi() {
    document.querySelector("#ywbFPContentManager")?.remove();
    const root = document.createElement("div");
    root.id = "ywbFPContentManager";
    root.innerHTML = `
      <style>
        #ywbFPContentManager{position:fixed;inset:24px 24px auto auto;width:min(640px,calc(100vw - 32px));max-height:calc(100vh - 48px);z-index:2147483647;background:#181818;color:#f8f0c8;border:2px solid #ffd000;border-radius:8px;box-shadow:0 24px 80px #0009;font:14px/1.45 Verdana,sans-serif;overflow:hidden}
        #ywbFPContentManager *{box-sizing:border-box}.ywb-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#ffd000;color:#111;font-weight:900}.ywb-close{border:0;background:#111;color:#ffd000;width:30px;height:30px;border-radius:6px;font-weight:900;cursor:pointer}
        .ywb-body{padding:14px 16px;display:grid;gap:12px;overflow:auto;max-height:calc(100vh - 112px)}.ywb-field{display:grid;gap:5px}.ywb-field span{color:#b9b09a;font-size:12px}.ywb-field input,.ywb-field select{width:100%;border:1px solid #504714;border-radius:6px;background:#111;color:#f8f0c8;padding:10px}.ywb-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .ywb-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.ywb-row button,.ywb-file{border:1px solid #ffd000;background:#282300;color:#ffd000;border-radius:6px;padding:10px 12px;font-weight:800;cursor:pointer}.ywb-row button.primary{background:#ffd000;color:#111}.ywb-row button.danger{border-color:#ff6b6b;color:#ffb3b3;background:#3a1111}
        #ywbFPContentLog{height:190px;overflow:auto;border:1px solid #403810;background:#101010;border-radius:6px;padding:8px;font:12px/1.45 Consolas,monospace}.ywb-log-row.success{color:#9ef59e}.ywb-log-row.error{color:#ff9e9e}.ywb-log-row.warning{color:#ffd86b}
        @media(max-width:720px){#ywbFPContentManager{inset:12px;width:calc(100vw - 24px)}.ywb-grid{grid-template-columns:1fr}}
      </style>
      <div class="ywb-head"><div>FPContentManager <span style="font-weight:400">${Config.VERSION}</span></div><button class="ywb-close" title="Close">X</button></div>
      <div class="ywb-body">
        <label class="ywb-field"><span>User or page access token</span><input id="ywbFPContentToken" placeholder="uses page runtime token if empty"></label>
        <div class="ywb-row"><button class="primary" id="ywbFPContentFetch">Fetch pages</button></div>
        <div class="ywb-grid">
          <label class="ywb-field"><span>Fetched page</span><select id="ywbFPContentPage"><option value="">Select fetched page</option></select></label>
          <label class="ywb-field"><span>Manual page ID</span><input id="ywbFPContentManualPage" placeholder="optional"></label>
        </div>
        <div class="ywb-row">
          <button class="primary" id="ywbFPContentExport">Export content</button>
          <label class="ywb-file">Load JSON<input id="ywbFPContentFile" type="file" accept=".json,application/json" hidden></label>
          <button id="ywbFPContentImport">Import text posts</button>
          <label class="ywb-field" style="width:120px"><span>Import limit</span><input id="ywbFPContentImportLimit" type="number" min="1" placeholder="all"></label>
        </div>
        <div class="ywb-grid">
          <label class="ywb-field"><span>Type selected page ID to confirm cleanup</span><input id="ywbFPContentConfirm" placeholder="page id"></label>
          <div class="ywb-row" style="align-self:end"><button class="danger" id="ywbFPContentClean">Clean posts/photos/videos</button></div>
        </div>
        <div id="ywbFPContentPackageInfo">No package loaded.</div>
        <div id="ywbFPContentLog"></div>
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
