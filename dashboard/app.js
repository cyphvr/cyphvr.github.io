(() => {
  const BASE = "/dashboard";
  const $ = (id) => document.getElementById(id);

  let csrf = "";
  let groups = [];
  let allKeys = [];
  let channels = [];
  let guilds = [];
  let guildId = "";
  let presets = {};
  let state = blank();
  let saved = blank();
  let open = "";
  let query = "";

  function blank() {
    return { channel: "", groupChannel: {}, eventChannel: {}, on: new Set() };
  }
  function pack(s) {
    return JSON.stringify({
      channel: s.channel,
      on: [...s.on].sort(),
      groupChannel: s.groupChannel,
      eventChannel: s.eventChannel,
    });
  }
  function dirty() { return pack(state) !== pack(saved); }
  function clone(s) {
    return {
      channel: s.channel,
      groupChannel: { ...s.groupChannel },
      eventChannel: { ...s.eventChannel },
      on: new Set(s.on),
    };
  }
  function destGroup(id) { return state.groupChannel[id] || state.channel; }
  function destEvent(key) { return state.eventChannel[key] || destGroup(key.split(".")[0]); }
  function usableChannels() { return channels.filter((c) => c.can_send); }
  function options(value) {
    const list = usableChannels();
    if (!list.length) return `<option value="">No writable channels</option>`;
    let html = "";
    let current = null;
    for (const c of list) {
      const cat = c.category || "Text channels";
      if (cat !== current) {
        if (current !== null) html += "</optgroup>";
        html += `<optgroup label="${esc(cat)}">`;
        current = cat;
      }
      html += `<option value="${c.id}" ${c.id === value ? "selected" : ""}>#${esc(c.name)}</option>`;
    }
    if (current !== null) html += "</optgroup>";
    return html;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }
  function switchEl(extra) {
    return `<button class="switch" type="button" role="switch" aria-checked="false" ${extra}><span class="knob"></span></button>`;
  }
  function sameSet(a, arr) {
    if (a.size !== arr.length) return false;
    return arr.every((k) => a.has(k));
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({ "Accept": "application/json" }, opts.headers || {});
    if (opts.method && opts.method !== "GET") {
      headers["X-CSRF-Token"] = csrf;
      if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
    const res = await fetch(BASE + path, { credentials: "same-origin", ...opts, headers });
    if (res.status === 401) {
      showGate();
      throw new Error("unauthorized");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "request failed");
    return data;
  }

  function showGate() {
    $("gate").classList.remove("hide");
    $("page").classList.add("hide");
    $("save").classList.remove("show");
    setFavicon(CYPHER_MARK);
    document.title = "Cypher · Logging";
  }
  function showApp() {
    $("gate").classList.add("hide");
    $("page").classList.remove("hide");
  }

  function eventsPayload() {
    const events = {};
    for (const key of state.on) {
      const ch = destEvent(key);
      if (ch) events[key] = ch;
    }
    return events;
  }

  function hydrate(eventsMap) {
    const next = blank();
    const entries = Object.entries(eventsMap || {});
    next.on = new Set(entries.map(([k]) => k));
    const counts = {};
    for (const [, id] of entries) counts[id] = (counts[id] || 0) + 1;
    next.channel = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || usableChannels()[0]?.id || "";
    const byGroup = {};
    for (const [key, id] of entries) {
      const g = key.split(".")[0];
      (byGroup[g] ||= new Set()).add(id);
    }
    groups.forEach((g) => {
      const set = byGroup[g.id];
      if (set && set.size === 1) {
        const only = [...set][0];
        if (only !== next.channel) next.groupChannel[g.id] = only;
      }
    });
    for (const [key, id] of entries) {
      const g = key.split(".")[0];
      const inherited = next.groupChannel[g] || next.channel;
      if (id !== inherited) next.eventChannel[key] = id;
    }
    return next;
  }

  function paintList() {
    const q = query.toLowerCase();
    const html = groups.map((g) => {
      const matchGroup = !q || g.label.toLowerCase().includes(q);
      const events = g.events.filter((e) => matchGroup || e.name.toLowerCase().includes(q) || e.key.includes(q));
      if (q && !events.length) return "";
      const isOpen = open === g.id || !!q;
      return `<div class="group ${isOpen ? "open" : ""}" data-group="${g.id}">
        <div class="ghead">
          <svg class="chev" viewBox="0 0 16 16" fill="none"><path d="M6 3.5 11 8 6 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span class="gtitle">${esc(g.label)}</span>
          <span class="gcount">0</span>
          <select class="ch" data-group-channel="${g.id}">${options(destGroup(g.id))}</select>
          ${switchEl(`data-group-toggle="${g.id}"`)}
        </div>
        <div class="gbody"><div class="ginner">
          ${events.map((e) => `<div class="grow">
            <div class="name">${esc(e.name)}</div>
            <select class="ch" data-event-channel="${e.key}">${options(destEvent(e.key))}</select>
            ${switchEl(`data-key="${e.key}"`)}
          </div>`).join("")}
        </div></div>
      </div>`;
    }).join("");
    $("list").innerHTML = html || `<div class="empty">No events match.</div>`;
    sync();
  }

  function sync() {
    document.querySelectorAll("[data-key]").forEach((el) => {
      el.setAttribute("aria-checked", state.on.has(el.dataset.key) ? "true" : "false");
    });
    groups.forEach((g) => {
      const root = document.querySelector(`[data-group="${g.id}"]`);
      if (!root) return;
      const n = g.events.filter((e) => state.on.has(e.key)).length;
      root.querySelector(".gcount").textContent = n;
      const sw = root.querySelector("[data-group-toggle]");
      if (sw) sw.setAttribute("aria-checked", n === g.events.length && n > 0 ? "true" : "false");
    });
    document.querySelectorAll("[data-group-channel]").forEach((sel) => {
      sel.value = destGroup(sel.dataset.groupChannel);
    });
    document.querySelectorAll("[data-event-channel]").forEach((sel) => {
      const key = sel.dataset.eventChannel;
      sel.value = destEvent(key);
      sel.disabled = !state.on.has(key);
    });
    $("summary").textContent = state.on.size + " live · " + Math.max(0, allKeys.length - state.on.size) + " silent";
    $("save").classList.toggle("show", dirty());
    document.querySelectorAll("[data-preset]").forEach((b) => {
      b.classList.toggle("on", sameSet(state.on, presets[b.dataset.preset] || []));
    });
    if (state.channel) $("defaultChannel").value = state.channel;
  }

  function setAllChannel(ch) {
    state.channel = ch;
    state.groupChannel = {};
    state.eventChannel = {};
    sync();
  }
  function setGroupChannel(id, ch) {
    state.groupChannel[id] = ch;
    groups.find((g) => g.id === id).events.forEach((e) => { delete state.eventChannel[e.key]; });
    sync();
  }
  function applyPreset(id) {
    state.on = new Set(presets[id] || []);
    sync();
  }

  const CYPHER_MARK = "https://cyphvr.xyz/images/cypher%20rebrand%20logo%20round%20(No%20BG).png";
  function guildIcon(g) {
    return (g && g.icon) || (BASE + "/discord.svg");
  }
  function setFavicon(href) {
    let link = document.querySelector("link[rel='icon'][data-dyn]");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.setAttribute("data-dyn", "1");
      document.head.appendChild(link);
    }
    link.type = String(href).endsWith(".svg") ? "image/svg+xml" : "image/png";
    link.href = href;
  }
  function bindIconFallback(root) {
    (root || document).querySelectorAll("img[data-fallback]").forEach((img) => {
      img.addEventListener("error", () => {
        const next = img.getAttribute("data-fallback");
        img.removeAttribute("data-fallback");
        if (next) img.src = next;
      }, { once: true });
    });
  }
  function paintGuilds() {
    const el = $("guilds");
    if (!el) return;
    el.innerHTML = guilds.map((g) => {
      const src = guildIcon(g);
      const face = `<img src="${esc(src)}" alt="" data-fallback="${BASE}/discord.svg">`;
      return `<button type="button" class="server ${g.id === guildId ? "on" : ""}" data-guild="${g.id}">${face}<span>${esc(g.name)}</span></button>`;
    }).join("");
    bindIconFallback(el);
  }
  async function loadGuild(id) {
    guildId = id;
    paintGuilds();
    const g = guilds.find((x) => x.id === id);
    if (g && $("guildName")) $("guildName").textContent = g.name;
    document.title = g ? `Cypher · ${g.name}` : "Cypher · Logging";
    setFavicon(guildIcon(g));
    const data = await api(`/api/guilds/${id}/logging`);
    channels = data.channels || [];
    $("defaultChannel").innerHTML = options("");
    state = hydrate(data.events || {});
    saved = clone(state);
    if (!open) open = groups[0]?.id || "";
    paintList();
  }

  function showSetup(on) {
    $("setup").classList.toggle("hide", !on);
    $("signIn").classList.toggle("hide", on);
    $("wrongHost").classList.add("hide");
  }
  function showWrongHost() {
    showGate();
    $("wrongHost").classList.remove("hide");
    $("setup").classList.add("hide");
    $("signIn").classList.add("hide");
  }

  async function boot() {
    let status;
    try {
      const res = await fetch(BASE + "/api/status", { credentials: "same-origin" });
      if (!res.ok) throw new Error("status");
      status = await res.json();
    } catch {
      showWrongHost();
      return;
    }
    if (status.redirect_uri) $("redirectUri").textContent = status.redirect_uri;
    if (status.client_id) $("clientId").textContent = status.client_id;
    if (!status.oauth) {
      showGate();
      showSetup(true);
      return;
    }
    showSetup(false);
    let session;
    try {
      session = await api("/api/session");
    } catch {
      showGate();
      showSetup(false);
      return;
    }
    csrf = session.csrf;
    $("username").textContent = session.user.username || "";
    if (session.user.avatar) {
      const img = $("avatar");
      img.src = session.user.avatar;
      img.hidden = false;
    }
    const [cat, guildPayload] = await Promise.all([api("/api/catalog"), api("/api/guilds")]);
    groups = cat.groups || [];
    allKeys = groups.flatMap((g) => g.events.map((e) => e.key));
    const essentials = new Set([
      "message.delete", "message.bulk-delete", "message.edit",
      "server.ban-add", "server.ban-remove", "server.user-kick", "server.user-join", "server.user-leave",
      "user.timed-out", "user.timeout-removed", "user.roles-add", "user.roles-remove",
      "channel.create", "channel.delete", "role.create", "role.delete",
    ]);
    presets = {
      essentials: allKeys.filter((k) => essentials.has(k)),
      all: allKeys,
      none: [],
    };
    $("tabs").innerHTML = [
      ["essentials", "Essentials"],
      ["all", "Everything"],
      ["none", "Off"],
    ].map(([id, label]) => `<button type="button" data-preset="${id}">${label}</button>`).join("");
    guilds = guildPayload.guilds || [];
    showApp();
    if (!guilds.length) {
      paintGuilds();
      $("list").innerHTML = `<div class="empty">No managed servers. Invite Cypher and make sure you have Manage Server.</div>`;
      return;
    }
    await loadGuild(guilds[0].id);
  }

  $("list").addEventListener("click", (e) => {
    const gToggle = e.target.closest("[data-group-toggle]");
    const keyEl = e.target.closest("[data-key]");
    if (gToggle) {
      const g = groups.find((x) => x.id === gToggle.dataset.groupToggle);
      const allOn = g.events.every((ev) => state.on.has(ev.key));
      g.events.forEach((ev) => allOn ? state.on.delete(ev.key) : state.on.add(ev.key));
      sync();
      return;
    }
    if (keyEl) {
      const key = keyEl.dataset.key;
      if (state.on.has(key)) state.on.delete(key);
      else state.on.add(key);
      sync();
      return;
    }
    if (e.target.closest("select")) return;
    const head = e.target.closest(".ghead");
    if (!head) return;
    const group = head.closest(".group");
    open = open === group.dataset.group ? "" : group.dataset.group;
    document.querySelectorAll(".group").forEach((el) => {
      el.classList.toggle("open", el.dataset.group === open);
    });
  });
  $("list").addEventListener("change", (e) => {
    const groupSel = e.target.closest("[data-group-channel]");
    const eventSel = e.target.closest("[data-event-channel]");
    if (groupSel) setGroupChannel(groupSel.dataset.groupChannel, groupSel.value);
    if (eventSel) {
      state.eventChannel[eventSel.dataset.eventChannel] = eventSel.value;
      sync();
    }
  });
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (b) applyPreset(b.dataset.preset);
  });
  $("search").addEventListener("input", (e) => {
    query = e.target.value;
    paintList();
  });
  $("defaultChannel").addEventListener("change", (e) => setAllChannel(e.target.value));
  $("guilds").addEventListener("click", (e) => {
    const b = e.target.closest("[data-guild]");
    if (b && b.dataset.guild !== guildId) loadGuild(b.dataset.guild).catch(() => {});
  });
  $("saveBtn").addEventListener("click", async () => {
    try {
      await api(`/api/guilds/${guildId}/logging`, {
        method: "PUT",
        body: JSON.stringify({ events: eventsPayload() }),
      });
      saved = clone(state);
      sync();
      $("toast").textContent = "Saved";
      $("toast").classList.add("show");
      setTimeout(() => $("toast").classList.remove("show"), 1400);
    } catch (err) {
      $("toast").textContent = err.message || "Save failed";
      $("toast").classList.add("show");
      setTimeout(() => $("toast").classList.remove("show"), 1800);
    }
  });
  $("discard").addEventListener("click", () => {
    state = clone(saved);
    $("defaultChannel").value = state.channel;
    paintList();
  });
  $("logout").addEventListener("click", async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    location.reload();
  });
  window.addEventListener("beforeunload", (e) => {
    if (!dirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    e.preventDefault();
    const box = $("search");
    if (box) box.focus();
  });

  boot().catch(() => showGate());
})();