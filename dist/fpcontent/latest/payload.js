(() => {
  "use strict";

  const Config = {
    VERSION: "240626b1",
    APP: "FPContentManager",
    API_URL: "https://graph.facebook.com/v23.0/",
  };
  const APP_ID = "ywbFPContentManager";
  const APP_TITLE = "FP Content Manager";
  const APP_MARK_SVG = `<svg class="ywb-mark" viewBox="0 0 96 96" aria-hidden="true"><defs><linearGradient id="${APP_ID}-gold" x1="0%" x2="100%" y1="0%" y2="100%"><stop offset="0%" stop-color="#ffe16a"/><stop offset="55%" stop-color="#ffd000"/><stop offset="100%" stop-color="#ffab00"/></linearGradient></defs><rect x="4" y="4" width="88" height="88" rx="22" fill="#151515" stroke="url(#${APP_ID}-gold)" stroke-width="6"/><path d="M28 24h40v48H28z" fill="#222" stroke="#fff2bd" stroke-width="4"/><path d="M36 36h24M36 47h18M36 58h24" stroke="url(#${APP_ID}-gold)" stroke-width="5" stroke-linecap="round"/><circle cx="66" cy="30" r="8" fill="url(#${APP_ID}-gold)"/></svg>`;

  if (window.__FPContentManagerPayloadBuild === Config.VERSION && typeof window.showFPContentManager === "function") {
    window.showFPContentManager();
    return;
  }
  window.__FPContentManagerPayloadBuild = Config.VERSION;

  const state = {
    pages: [],
    logs: [],
    loadingPages: false,
    busy: false,
    logsOpen: false,
  };

  function runtimeToken() {
    if (window.__accessToken) return window.__accessToken;
    for (const entry of performance.getEntriesByType("resource").map((item) => item.name || "")) {
      if (!entry.includes("access_token=")) continue;
      try {
        const token = new URL(entry).searchParams.get("access_token");
        if (token) return token;
      } catch (error) {
        // Ignore malformed resource URLs.
      }
    }
    return "";
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
    if (state.logs.length > 400) state.logs.shift();
    renderLogs();
    (type === "error" ? console.error : console.log)(`[${Config.APP}] ${message}`);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function renderLogs() {
    const root = document.querySelector("#ywbFPContentManager");
    if (!root) return;
    const box = root.querySelector("#ywbFPContentLog");
    const toggle = root.querySelector("#ywbFPContentLogToggle");
    const count = root.querySelector("#ywbFPContentLogCount");
    const last = root.querySelector("#ywbFPContentLogLast");
    const latest = state.logs[state.logs.length - 1];
    root.querySelector("#ywbFPContentLogs")?.classList.toggle("open", state.logsOpen);
    if (toggle) {
      toggle.setAttribute("aria-expanded", state.logsOpen ? "true" : "false");
      toggle.textContent = state.logsOpen ? "Hide logs" : "Show logs";
    }
    if (count) count.textContent = String(state.logs.length);
    if (last) last.textContent = latest ? `[${latest.ts.slice(11, 19)}] ${latest.message}` : "No log entries yet.";
    if (!box) return;
    box.innerHTML = state.logs
      .map((item) => `<div class="ywb-log-row ${escapeHtml(item.type)}">[${escapeHtml(item.ts.slice(11, 19))}] ${escapeHtml(item.message)}</div>`)
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  function setBusy(value) {
    state.busy = Boolean(value);
    document.querySelectorAll("#ywbFPContentManager button, #ywbFPContentManager select, #ywbFPContentManager input").forEach((element) => {
      if (element.id === "ywbFPContentLogToggle") return;
      element.disabled = state.busy || (state.loadingPages && element.tagName === "SELECT");
    });
  }

  class GraphApi {
    constructor(token = runtimeToken()) {
      this.token = token;
      if (!this.token) throw new Error("Facebook access token not found. Wait for Ads Manager to fully load and run the bookmarklet again.");
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
      const requestUrl = this.url(path, params);
      let response;
      try {
        response = await fetch(requestUrl, {
          mode: "cors",
          credentials: "include",
          redirect: "follow",
          referrer: "https://adsmanager.facebook.com/",
          referrerPolicy: "strict-origin-when-cross-origin",
          cache: "no-store",
          ...init,
        });
      } catch (error) {
        const method = init.method || "GET";
        const endpoint = requestUrl.replace(/\?.*$/, "");
        throw new Error(`${method} ${endpoint} failed: ${error.message}`);
      }
      const text = await response.text();
      let json = {};
      try {
        json = text ? JSON.parse(text.replace(/^for\s*\(;;\);\s*/, "")) : {};
      } catch (error) {
        throw new Error(`Graph response is not JSON: ${text.slice(0, 180)}`);
      }
      if (!response.ok || json.error) throw new Error(json.error?.message || `${response.status} ${text.slice(0, 180)}`);
      return json;
    }

    get(path, params = {}) {
      return this.request(path, params);
    }

    post(path, body = {}) {
      const form = new URLSearchParams();
      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined && value !== null) form.set(key, String(value));
      });
      return this.request(path, {}, {
        method: "POST",
        body: form.toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
    }

    delete(path) {
      return this.request(path, {}, { method: "DELETE" });
    }

    async getAll(path, params = {}, options = {}) {
      let url = this.url(path, params);
      const items = [];
      const maxItems = Number.isFinite(options.maxItems) && options.maxItems > 0 ? Math.floor(options.maxItems) : Infinity;
      const maxPages = Number.isFinite(options.maxPages) && options.maxPages > 0 ? Math.floor(options.maxPages) : Infinity;
      const seenUrls = new Set();
      let pageCount = 0;
      while (url && items.length < maxItems && pageCount < maxPages) {
        if (seenUrls.has(url)) throw new Error(`Graph pagination loop detected for ${path}.`);
        seenUrls.add(url);
        pageCount += 1;
        const page = await this.request(url);
        if (Array.isArray(page.data)) {
          for (const item of page.data) {
            if (items.length >= maxItems) break;
            items.push(item);
          }
        }
        url = page.paging?.next || "";
      }
      return items;
    }
  }

  async function privateApiRequest(variables, docId, friendlyName = "CometMutation") {
    const req = window.require;
    if (typeof req !== "function") throw new Error("Facebook runtime require() is unavailable; chronology mutation cannot run on this page.");
    const lsd = req("LSD")?.token;
    const fbDtsg = req("DTSGInitData")?.token || req("DTSGInitialData")?.token;
    if (!lsd || !fbDtsg) throw new Error("Facebook private API tokens are unavailable.");
    const currentProfile = currentFacebookProfileId();
    const body = new URLSearchParams({
      av: currentProfile || "",
      __user: currentProfile || "",
      __a: "1",
      __comet_req: "15",
      fb_dtsg: fbDtsg,
      lsd,
      variables: JSON.stringify(variables),
      server_timestamps: "true",
      doc_id: docId,
    });
    const response = await fetch("https://www.facebook.com/api/graphql/", {
      method: "POST",
      credentials: "include",
      mode: "cors",
      headers: {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded",
        "x-fb-friendly-name": friendlyName,
        "x-fb-lsd": lsd,
      },
      body,
    });
    const text = (await response.text()).replace(/^for\s*\(;;\);\s*/, "");
    const firstJson = text.split("\n").find((line) => line.trim().startsWith("{")) || "{}";
    const json = JSON.parse(firstJson);
    if (!response.ok || json.errors) throw new Error(json.errors?.[0]?.message || `${response.status} ${text.slice(0, 180)}`);
    return json;
  }

  function currentFacebookProfileId() {
    const match = document.cookie.match(/(?:^|;\s*)i_user=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  async function getMainFacebookUser() {
    const api = new GraphApi();
    return api.get("me", { fields: "id,name" });
  }

  async function switchFacebookProfile(fromProfileId, toProfileId) {
    const req = window.require;
    if (typeof req !== "function") throw new Error("Facebook runtime require() is unavailable; profile switch cannot run on this page.");
    const lsd = req("LSD")?.token;
    const fbDtsg = req("DTSGInitData")?.token || req("DTSGInitialData")?.token;
    if (!lsd || !fbDtsg) throw new Error("Facebook profile switch tokens are unavailable.");
    const response = await fetch("https://www.facebook.com/api/graphql/", {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-origin",
        "x-fb-friendly-name": "CometProfileSwitchMutation",
        "x-fb-lsd": lsd,
      },
      body: new URLSearchParams({
        av: fromProfileId,
        __user: fromProfileId,
        __a: "1",
        __req: "1",
        dpr: "1",
        __ccg: "EXCELLENT",
        __comet_req: "15",
        fb_dtsg: fbDtsg,
        jazoest: "25493",
        lsd,
        fb_api_caller_class: "RelayModern",
        fb_api_req_friendly_name: "CometProfileSwitchMutation",
        variables: JSON.stringify({ profile_id: toProfileId }),
        doc_id: "29569331136046912",
      }).toString(),
    });
    const text = (await response.text()).replace(/^for\s*\(;;\);\s*/, "");
    const json = JSON.parse(text || "{}");
    if (!response.ok || json.errors) throw new Error(json.errors?.[0]?.message || `Profile switch failed: ${response.status}`);
    return json?.data?.profile_switcher_comet_login;
  }

  async function runAsTargetPage(page, action) {
    if (!page?.profileId) {
      throw new Error(`Target page ${page?.name || page?.id || ""} has no additional_profile_id; cannot switch posting actor to the Page.`);
    }
    const mainUser = await getMainFacebookUser();
    const startProfile = currentFacebookProfileId() || String(mainUser.id || "");
    const targetProfile = String(page.profileId);
    let switched = false;
    if (startProfile !== targetProfile) {
      log(`Switching posting actor to ${page.name}...`);
      const result = await switchFacebookProfile(startProfile, targetProfile);
      if (!result) throw new Error("Failed to switch to target Page profile.");
      switched = true;
      await sleep(1000);
      log(`Posting actor is now ${page.name}.`, "success");
    } else {
      log(`Already posting as ${page.name}.`);
    }
    try {
      return await action();
    } finally {
      if (switched && startProfile && startProfile !== targetProfile) {
        try {
          log("Restoring previous Facebook profile...");
          await switchFacebookProfile(targetProfile, startProfile);
          await sleep(1000);
          log("Previous Facebook profile restored.", "success");
        } catch (error) {
          log(`Could not restore previous Facebook profile: ${error.message}`, "warning");
        }
      }
    }
  }

  async function fetchPages() {
    const api = new GraphApi();
    state.loadingPages = true;
    renderPageSelects();
    setBusy(state.busy);
    log("Loading Facebook Pages...");
    try {
      const pages = await api.getAll("me/accounts", {
        fields: "id,name,access_token,additional_profile_id,picture.type(large)",
        limit: 250,
      });
      state.pages = pages.map((page) => ({
        id: page.id,
        name: page.name || page.id,
        accessToken: page.access_token || runtimeToken(),
        profileId: page.additional_profile_id || "",
        avatar: page.picture?.data?.url || "",
      }));
      renderPageSelects();
      log(`Loaded ${state.pages.length} page(s).`, "success");
      return state.pages;
    } finally {
      state.loadingPages = false;
      renderPageSelects();
      setBusy(state.busy);
    }
  }

  function pageLabel(page) {
    return `${page.name || page.id} (${page.id})`;
  }

  function renderPageSelects() {
    const source = document.querySelector("#ywbFPContentSourceSelect");
    const target = document.querySelector("#ywbFPContentTargetPage");
    for (const select of [source, target]) {
      if (!select) continue;
      const currentValue = select.value;
      if (state.loadingPages) {
        select.innerHTML = `<option value="">Loading pages...</option>`;
        select.disabled = true;
        continue;
      }
      select.disabled = state.busy;
      if (!state.pages.length) {
        select.innerHTML = `<option value="">No pages loaded</option>`;
        continue;
      }
      const firstLabel = select === source ? "Select owned source page or paste ID below" : "Select target page";
      select.innerHTML = `<option value="">${firstLabel}</option>` + state.pages
        .map((page) => `<option value="${escapeHtml(page.id)}">${escapeHtml(pageLabel(page))}</option>`)
        .join("");
      if (currentValue && state.pages.some((page) => page.id === currentValue)) select.value = currentValue;
    }
  }

  function getTargetPage() {
    const id = document.querySelector("#ywbFPContentTargetPage")?.value || "";
    const page = state.pages.find((item) => item.id === id);
    if (page) return page;
    throw new Error("Select a target Facebook Page.");
  }

  function getSourcePageId() {
    const pasted = document.querySelector("#ywbFPContentSourceId")?.value.trim() || "";
    const selected = document.querySelector("#ywbFPContentSourceSelect")?.value.trim() || "";
    const id = pasted || selected;
    if (!id) throw new Error("Select or paste a source Page ID.");
    return id.replace(/[^\d]/g, "");
  }

  function getPostLimit() {
    const value = Number(document.querySelector("#ywbFPContentPostLimit")?.value || 20);
    if (!Number.isFinite(value) || value < 1) throw new Error("Post count must be at least 1.");
    return Math.min(Math.floor(value), 250);
  }

  function collectPostMedia(attachments = []) {
    const images = [];
    const videos = [];
    const seenImages = new Set();
    const seenVideos = new Set();
    const visit = (node) => {
      if (!node) return;
      const media = node.media || node;
      const type = String(node.media_type || node.type || "").toLowerCase();
      const target = node.target || {};
      const targetId = target.id ? String(target.id) : "";
      const sourceUrl = media?.source || media?.playable_url || node.source || "";
      const isVideo = type.includes("video") || Boolean(sourceUrl && targetId);
      if (isVideo) {
        const key = targetId || sourceUrl || node.url || JSON.stringify(node).slice(0, 120);
        if (!seenVideos.has(key)) {
          seenVideos.add(key);
          videos.push({
            id: targetId,
            sourceUrl,
            title: node.title || "",
            description: node.description || "",
            url: node.url || target.url || "",
          });
        }
      }
      const imageUrl = media?.image?.src || media?.photo_image?.uri || "";
      if (imageUrl && !isVideo && !seenImages.has(imageUrl)) {
        seenImages.add(imageUrl);
        images.push(imageUrl);
      }
      const sub = node.subattachments?.data || node.child_attachments || [];
      if (Array.isArray(sub)) sub.forEach(visit);
    };
    attachments.forEach(visit);
    return { images, videos };
  }

  async function fetchSourcePosts(sourcePageId, limit) {
    const api = new GraphApi();
    const fetchLimit = Math.min(250, Math.max(limit, Math.min(100, limit + 20)));
    const posts = await api.getAll(`${sourcePageId}/posts`, {
      fields: "id,message,created_time,permalink_url,attachments{target{id,url},media,media_type,type,title,url,description,subattachments{target{id,url},media,media_type,type,title,url,description}}",
      limit: fetchLimit,
    }, {
      maxItems: fetchLimit,
      maxPages: Math.max(1, Math.ceil(fetchLimit / 100) + 1),
    });
    return posts
      .sort((left, right) => new Date(right.created_time || 0).getTime() - new Date(left.created_time || 0).getTime())
      .slice(0, limit);
  }

  function relevantStoryId(id) {
    const raw = String(id || "");
    return raw.includes("_") ? raw.split("_").pop() : raw;
  }

  function encodedStoryId(page, createdId) {
    const storyId = relevantStoryId(createdId);
    const profileId = page.profileId || page.id;
    return btoa(`S:_I${profileId}:${storyId}:${storyId}`);
  }

  function nextBackdate(index) {
    const date = new Date();
    date.setDate(date.getDate() - (index + 1));
    date.setHours(9 + ((index * 3) % 11), (index * 17) % 60, 0, 0);
    return {
      day: date.getDate(),
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }

  async function updateDate(page, createdId, backdateInfo) {
    const variables = {
      input: {
        backdate_info: backdateInfo,
        story_id: encodedStoryId(page, createdId),
        actor_id: page.id,
        client_mutation_id: String(Date.now()),
      },
    };
    return privateApiRequest(variables, "6790117984341989", "CometStoryBackdateMutation");
  }

  async function applyChronology(page, createdIds) {
    const ids = createdIds.filter(Boolean);
    if (!ids.length) return { updated: 0, total: 0 };
    log(`Creating chronology for ${ids.length} copied item(s)...`);
    let updated = 0;
    for (let index = 0; index < ids.length; index += 1) {
      try {
        await updateDate(page, ids[index], nextBackdate(index));
        updated += 1;
        log(`Updated date ${updated}/${ids.length}.`, "success");
      } catch (error) {
        log(`Failed to update date for ${ids[index]}: ${error.message}`, "error");
      }
    }
    log(`Chronology finished: ${updated}/${ids.length}.`, updated === ids.length ? "success" : "warning");
    return { updated, total: ids.length };
  }

  async function resolveVideoSource(api, video) {
    if (video.sourceUrl) return video.sourceUrl;
    if (!video.id) return "";
    const details = await api.get(video.id, { fields: "id,source,permalink_url,title,description" });
    if (details.title && !video.title) video.title = details.title;
    if (details.description && !video.description) video.description = details.description;
    if (details.permalink_url && !video.url) video.url = details.permalink_url;
    return details.source || "";
  }

  async function publishVideoToTarget(api, targetPage, sourcePost, video, index) {
    const sourceUrl = await resolveVideoSource(api, video);
    if (!sourceUrl) throw new Error(`No copyable video source for ${video.id || sourcePost.id}.`);
    const message = String(sourcePost.message || video.description || "").trim();
    const body = {
      file_url: sourceUrl,
      title: video.title || `Copied video ${index + 1}`,
      description: message,
      published: "true",
    };
    const response = await api.post(`${targetPage.id}/videos`, body);
    return response.post_id || response.id;
  }

  async function publishImagesToTarget(api, targetPage, sourcePost, imageUrls, message) {
    const created = [];
    for (const imageUrl of imageUrls) {
      try {
        const response = await api.post(`${targetPage.id}/photos`, {
          url: imageUrl,
          caption: message,
        });
        created.push(response.post_id || response.id);
      } catch (error) {
        log(`Photo copy failed for ${sourcePost.id}: ${error.message}`, "warning");
      }
    }
    return created;
  }

  async function publishFeedFallback(api, targetPage, sourcePost, reason) {
    if (reason) log(`Trying feed fallback for ${sourcePost.id}: ${reason}`, "warning");
    const fallbackBody = {};
    const message = String(sourcePost.message || "").trim();
    if (message) fallbackBody.message = message;
    if (sourcePost.permalink_url) fallbackBody.link = sourcePost.permalink_url;
    if (!fallbackBody.message && !fallbackBody.link) {
      log(`Skipping ${sourcePost.id}: no text, link, or copyable media.`, "warning");
      return [];
    }
    const response = await api.post(`${targetPage.id}/feed`, fallbackBody);
    return [response.id];
  }

  async function publishPostToTarget(targetPage, sourcePost) {
    const api = new GraphApi(targetPage.accessToken || runtimeToken());
    const message = String(sourcePost.message || "").trim();
    const { images, videos } = collectPostMedia(sourcePost.attachments?.data || []);
    const created = [];
    if (videos.length) {
      for (let index = 0; index < videos.length; index += 1) {
        try {
          const id = await publishVideoToTarget(api, targetPage, sourcePost, videos[index], index);
          if (id) created.push(id);
        } catch (error) {
          log(`Video copy failed for ${sourcePost.id}: ${error.message}`, "warning");
        }
      }
      if (created.length) return created;
      return publishFeedFallback(api, targetPage, sourcePost, "video upload failed");
    }
    if (images.length) {
      created.push(...await publishImagesToTarget(api, targetPage, sourcePost, images, message));
      if (created.length) {
        return created;
      }
    }
    return publishFeedFallback(api, targetPage, sourcePost, images.length ? "photo upload failed" : "");
  }

  async function copyContent() {
    const sourcePageId = getSourcePageId();
    const targetPage = getTargetPage();
    const limit = getPostLimit();
    const shouldChronology = Boolean(document.querySelector("#ywbFPContentChronology")?.checked);
    setBusy(true);
    try {
      return await runAsTargetPage(targetPage, async () => {
        log(`Copying ${limit} post(s) from ${sourcePageId} to ${targetPage.name} (${targetPage.id})...`);
        const posts = await fetchSourcePosts(sourcePageId, limit);
        const createdIds = [];
        let copied = 0;
        for (const post of posts) {
          try {
            const created = await publishPostToTarget(targetPage, post);
            if (created.length) {
              copied += 1;
              createdIds.push(...created);
              log(`Copied post ${copied}/${posts.length}.`, "success");
            }
          } catch (error) {
            log(`Failed to copy ${post.id}: ${error.message}`, "error");
          }
        }
        log(`Copy finished: ${copied}/${posts.length} source post(s).`, copied ? "success" : "warning");
        if (shouldChronology) await applyChronology(targetPage, createdIds.slice().reverse());
        return { copied, total: posts.length, createdIds };
      });
    } finally {
      setBusy(false);
    }
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

  async function getPageReelIds(pageId) {
    const variables = {
      callerID: "BIZWEB_CREATOR_STUDIO_PUBLISHED_POST_TAB",
      contentArgs: {
        filter_by: {
          custom: [
            { param: "ENTITY_TYPE", values: ["FB_PAGE_POST"] },
            { param: "EXPIRATION_TYPE", values: ["NO_EXPIRATION", "EXPIRING"] },
          ],
        },
        qualify_by: { video_insights_query_params: { aggregation_type: null, metric: null } },
        sort_by: { direction: "DESC", event: "CREATE", metric: "TIME", qualifiers: null, time_range: null },
        time_range: { type: "LAST_90D" },
      },
      first: 100,
      ids: [pageId],
      shouldIncludeBusinessContentFragment: true,
      shouldIncludeBusinessContentPermissionFragment: false,
      shouldIncludeReviewRequestFragment: false,
      shouldShowPrivacyIcon: false,
      __relay_internal__pv__WebPixelRatiorelayprovider: 1,
    };
    const json = await privateApiRequest(variables, "9087218914708157", "BusinessContentManagerTableRootQuery");
    const edges = json.data?.entity_list?.content?.edges || [];
    return edges.map((edge) => edge.node?.entity_id).filter(Boolean);
  }

  async function deleteReelById(pageId, reelId) {
    const variables = {
      input: {
        client_mutation_id: String(Date.now()),
        actor_id: pageId,
        ig_business_account_id: "",
        business_contents: [{ content_id: reelId, product_type: "FACEBOOK", owner_id: pageId }],
        unpublished_content_type: null,
      },
    };
    return privateApiRequest(variables, "6436140666464442", "BusinessContentDeleteMutation");
  }

  async function deleteReels(page) {
    let found = 0;
    let deleted = 0;
    try {
      const reelIds = await getPageReelIds(page.id);
      found = reelIds.length;
      log(`Found ${found} reel(s).`);
      for (const reelId of reelIds) {
        try {
          await deleteReelById(page.id, reelId);
          deleted += 1;
          log(`Deleted reel ${reelId}.`, "success");
        } catch (error) {
          log(`Failed to delete reel ${reelId}: ${error.message}`, "error");
        }
      }
    } catch (error) {
      log(`Could not load reels: ${error.message}`, "warning");
    }
    return { found, deleted };
  }

  async function cleanContent(page = getTargetPage()) {
    if (!confirm(`Delete posts, uploaded photos, videos, and reels from ${page.name} (${page.id})?`)) {
      log("Cleanup cancelled.", "warning");
      return { cancelled: true };
    }
    setBusy(true);
    try {
      return await runAsTargetPage(page, async () => {
        const api = new GraphApi(page.accessToken || runtimeToken());
        log(`Cleaning content for ${page.name} (${page.id})...`, "warning");
        const posts = await deleteEdgeItems(api, `${page.id}/posts`, "post");
        const photos = await deleteEdgeItems(api, `${page.id}/photos?type=uploaded`, "photo");
        const videos = await deleteEdgeItems(api, `${page.id}/videos`, "video");
        const reels = await deleteReels(page);
        log(`Cleanup finished: posts ${posts.deleted}/${posts.found}, photos ${photos.deleted}/${photos.found}, videos ${videos.deleted}/${videos.found}, reels ${reels.deleted}/${reels.found}.`, "success");
        return { posts, photos, videos, reels };
      });
    } finally {
      setBusy(false);
    }
  }

  function createUi() {
    document.querySelector("#ywbFPContentManager")?.remove();
    const root = document.createElement("div");
    root.id = "ywbFPContentManager";
    root.innerHTML = `
      <style>
        #ywbFPContentManager{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;pointer-events:none;font:13px/1.4 "Segoe UI","Trebuchet MS",sans-serif;color:#f5f5f5}
        #ywbFPContentManager *{box-sizing:border-box}
        #ywbFPContentManager .ywb-shell{position:relative;width:min(660px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 32px));background:#1a1a1a;border:2px solid #ffc107;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.7);padding:16px;overflow:hidden;pointer-events:auto;display:flex;flex-direction:column}
        .ywb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px;flex:0 0 auto}.ywb-title-row{display:inline-flex;align-items:center;gap:10px}.ywb-mark{width:30px;height:30px;display:block;flex:0 0 auto;filter:drop-shadow(0 6px 14px rgba(255,193,7,.18))}
        .ywb-head h2{margin:0;color:#ffc107;font-size:20px;line-height:1.08;letter-spacing:0}.ywb-build{font-size:12px;font-weight:600;color:#aaa;vertical-align:middle;margin-left:4px}.ywb-byline{display:block;font-size:12px;color:#ffc107;text-decoration:none;opacity:.7;margin-top:2px}.ywb-byline:hover{opacity:1;text-decoration:underline}
        .ywb-close{border:1px solid #ffc107;background:#2a2a2a;color:#ffc107;width:32px;height:32px;border-radius:6px;font-weight:900;cursor:pointer;flex:0 0 auto}.ywb-close:hover{background:#ffc107;color:#111}
        .ywb-content{min-height:0;overflow:auto;padding-right:4px}.ywb-body{display:grid;gap:12px}.ywb-section{display:grid;gap:10px;border:1px solid #333;background:#202020;border-radius:8px;padding:12px}.ywb-section-title{margin:0;color:#ffc107;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
        .ywb-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ywb-field{display:grid;gap:5px}.ywb-field span{color:#aaa;font-size:12px}.ywb-field input,.ywb-field select{width:100%;border:1px solid #555;border-radius:6px;background:#2a2a2a;color:#f5f5f5;padding:9px 12px;font-size:13px}.ywb-field select:disabled,.ywb-field input:disabled{opacity:.7}
        .ywb-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.ywb-row button{border:1px solid #ffc107;background:#ffc107;color:#111;border-radius:6px;padding:9px 12px;font-weight:800;cursor:pointer;min-height:40px}.ywb-row button.danger{border-color:#ff2f2f;color:#fff;background:#b41414}.ywb-row button.danger:hover{background:#df1f1f}.ywb-row button:hover:not(:disabled){filter:brightness(1.08)}.ywb-row button:disabled{opacity:.55;cursor:not-allowed}
        .ywb-check{display:flex;gap:8px;align-items:center;color:#aaa}.ywb-note{color:#aaa;font-size:12px}
        .ywb-logs{border:1px solid #444;background:#141414;border-radius:8px;overflow:hidden}.ywb-logs-head{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:8px 10px;border-bottom:1px solid #333}.ywb-logs-title{display:flex;align-items:center;gap:8px;color:#ffc107;font-weight:800}.ywb-log-count{min-width:22px;height:20px;border:1px solid #5f4b00;border-radius:999px;display:inline-grid;place-items:center;color:#aaa;font-size:11px;font-weight:700}.ywb-log-last{grid-column:1/-1;min-width:0;color:#aaa;font:11px/1.35 Consolas,"Courier New",monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        #ywbFPContentLogToggle{border:1px solid #ffc107;background:#2a2a2a;color:#ffc107;border-radius:6px;padding:6px 10px;font-weight:800;cursor:pointer}.ywb-log-body{display:none;border-top:1px solid #222}.ywb-logs.open .ywb-log-body{display:block}#ywbFPContentLog{height:132px;overflow:auto;background:#101010;color:#ccc;padding:8px;font:11px/1.4 Consolas,"Courier New",monospace;white-space:pre-wrap}.ywb-log-row.success{color:#9ef59e}.ywb-log-row.error{color:#ff9e9e}.ywb-log-row.warning{color:#ffd86b}
        @media(max-width:720px){#ywbFPContentManager{padding:10px}.ywb-shell{width:calc(100vw - 20px);max-height:calc(100vh - 20px)}.ywb-grid{grid-template-columns:1fr}.ywb-row{flex-direction:column;align-items:stretch}.ywb-row button{width:100%}.ywb-head h2{font-size:18px}.ywb-build{display:block;margin:2px 0 0}}
      </style>
      <div class="ywb-shell">
        <div class="ywb-head">
          <div>
            <div class="ywb-title-row">${APP_MARK_SVG}<h2>${APP_TITLE} <span class="ywb-build">build ${escapeHtml(Config.VERSION)}</span></h2></div>
            <a class="ywb-byline" href="https://yellowweb.top" target="_blank" rel="noopener">by Yellow Web</a>
          </div>
          <button class="ywb-close" title="Close">&#x2715;</button>
        </div>
        <div class="ywb-content">
          <div class="ywb-body">
            <section class="ywb-section">
              <p class="ywb-section-title">Copy content</p>
              <label class="ywb-field"><span>Owned source page</span><select id="ywbFPContentSourceSelect"><option value="">Loading pages...</option></select></label>
              <label class="ywb-field"><span>Source Page ID</span><input id="ywbFPContentSourceId" type="text" inputmode="numeric" placeholder="Paste any source Page ID"></label>
              <div class="ywb-grid">
                <label class="ywb-field"><span>Target Page</span><select id="ywbFPContentTargetPage"><option value="">Loading pages...</option></select></label>
                <label class="ywb-field"><span>Post count</span><input id="ywbFPContentPostLimit" type="number" min="1" max="250" step="1" value="20"></label>
              </div>
              <label class="ywb-check"><input id="ywbFPContentChronology" type="checkbox"> set dates for copied posts / create chronology</label>
              <div class="ywb-row"><button class="primary" id="ywbFPContentCopy">Copy content</button></div>
            </section>
            <section class="ywb-section">
              <p class="ywb-section-title">Clean target page</p>
              <div class="ywb-note">Deletes posts, uploaded photos, videos, and reels from the selected target Page.</div>
              <div class="ywb-row"><button class="danger" id="ywbFPContentClean">&#x2620; Clean target content</button></div>
            </section>
            <section class="ywb-logs" id="ywbFPContentLogs">
              <div class="ywb-logs-head">
                <div class="ywb-logs-title">Logs <span class="ywb-log-count" id="ywbFPContentLogCount">0</span></div>
                <button id="ywbFPContentLogToggle" type="button" aria-expanded="false">Show logs</button>
                <div class="ywb-log-last" id="ywbFPContentLogLast">No log entries yet.</div>
              </div>
              <div class="ywb-log-body"><div id="ywbFPContentLog"></div></div>
            </section>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.querySelector(".ywb-close").onclick = () => root.remove();
    root.querySelector("#ywbFPContentLogToggle").onclick = () => {
      state.logsOpen = !state.logsOpen;
      renderLogs();
    };
    root.querySelector("#ywbFPContentSourceSelect").onchange = (event) => {
      const input = root.querySelector("#ywbFPContentSourceId");
      if (event.target.value && input) input.value = event.target.value;
    };
    root.querySelector("#ywbFPContentCopy").onclick = () => copyContent().catch((error) => {
      setBusy(false);
      log(error.message, "error");
    });
    root.querySelector("#ywbFPContentClean").onclick = () => cleanContent().catch((error) => {
      setBusy(false);
      log(error.message, "error");
    });
    renderLogs();
    log("Ready.");
    fetchPages().catch((error) => log(error.message, "error"));
  }

  window.showFPContentManager = async () => createUi();
  window.FPContentManager = {
    Config,
    state,
    fetchPages,
    copyContent,
    cleanContent,
    applyChronology,
    debug: { runtimeToken, privateApiRequest, getPageReelIds, updateDate },
  };

  createUi();
})();
