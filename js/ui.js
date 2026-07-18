(function () {
  "use strict";
  var economy = GL.economy, state = GL.state, rewards = GL.rewards, game = GL.game;

  var save = game.onLoad(state.load());
  var current = "quarters";
  var bountyFilter = "all";
  var poseOffset = 0;
  var DAILY_EST = 200;
  var quickStat = "resolve";
  try { quickStat = localStorage.getItem("gl.quickStat") || "resolve"; } catch (e) {}
  var journalFilter = "all";
  var journalQuery = "";
  var journalDate = "";
  var poseSelectedDay = null;
  var bountyStatus = "open";
  var bountySort = "new";
  var editingBounty = null;
  var pendingConfirm = null;
  var deferredPrompt = null;
  var RANK_FACE = { "East Blue Pirate": "⚓", "Notorious Pirate": "🏴‍☠️", "Warlord of the Sea": "⚔️", "Yonko": "🔱", "King of the Pirates": "👑" };
  var TIER_ORDER = { petty: 0, rookie: 1, notorious: 2, warlord: 3 };
  var STAT_FLAVOR = { strength: "Crushed it.", wisdom: "Outwitted them.", ambition: "Conquered.", resolve: "Endured." };
  var STAT_SIGIL = { strength: "ti-sword", wisdom: "ti-eye", ambition: "ti-crown", resolve: "ti-anchor" };
  var LOG_LABEL = { captains_log: "Captain's Log", morning_intent: "Intent", evening_reflection: "Reflection", free_write: "Free Log", memory: "Memory", mood: "Weather", victory: "Victory", recap: "Recap" }
  var JF_ICON = {captains_log:'ti-book',morning_intent:'ti-sun',evening_reflection:'ti-moon',free_write:'ti-feather',memory:'ti-star',mood:'ti-cloud',victory:'ti-trophy',recap:'ti-chart-bar'};;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function accent(statKey) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(economy.STATS[statKey].accent);
    return (v || "#1b2a4a").trim();
  }
  function fmt(n) { return Number(n).toLocaleString(); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* ---------------- DRAFT PERSISTENCE (never lose typing) ---------------- */
  var DRAFT_KEY = "grandline.drafts.v1";
  var DRAFT_FIELDS = ["morningIntent", "eveningReflect", "freeWrite", "recapText", "quickLog", "quickMemoryText", "bountyTitle", "quickBountyTitle"];
  function getDrafts() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); } catch (e) { return {}; } }
  function setDraft(id, val) { var d = getDrafts(); if (val) d[id] = val; else delete d[id]; try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) {} }
  function clearDraft(id) { setDraft(id, ""); }
  function restoreDrafts() {
    var d = getDrafts();
    DRAFT_FIELDS.forEach(function (id) {
      var x = document.getElementById(id);
      if (x && !x.value && document.activeElement !== x && d[id]) x.value = d[id];
    });
  }
  function flushSave() { try { state.save(save); } catch (e) {} }

  /* ---------------- FILE AUTO-BACKUP (my-tasks "Link file" pattern) ---------------- */
  var backup = (function () {
    var DB = "grandline-backup", STORE = "handles", HK = "fileHandle";
    var handle = null, ready = false, writing = false, pending = null;
    function supported() { return typeof window.showSaveFilePicker === "function"; }
    function idb() {
      return new Promise(function (res, rej) {
        var r = indexedDB.open(DB, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    }
    function idbGet() { return idb().then(function (db) { return new Promise(function (res) { var t = db.transaction(STORE, "readonly").objectStore(STORE).get(HK); t.onsuccess = function () { res(t.result || null); }; t.onerror = function () { res(null); }; }); }); }
    function idbSet(v) { return idb().then(function (db) { return new Promise(function (res) { var s = db.transaction(STORE, "readwrite").objectStore(STORE); s.put(v, HK); s.transaction.oncomplete = function () { res(); }; }); }); }
    function idbDel() { return idb().then(function (db) { return new Promise(function (res) { var s = db.transaction(STORE, "readwrite").objectStore(STORE); s.delete(HK); s.transaction.oncomplete = function () { res(); }; }); }); }
    function verify(h, request) {
      var opts = { mode: "readwrite" };
      if (!h.queryPermission) return Promise.resolve(true);
      return h.queryPermission(opts).then(function (p) {
        if (p === "granted") return true;
        if (request && h.requestPermission) return h.requestPermission(opts).then(function (p2) { return p2 === "granted"; });
        return false;
      });
    }
    function writeNow(raw) {
      if (!handle || !ready) return Promise.resolve();
      if (writing) { pending = raw; return Promise.resolve(); }
      writing = true;
      return handle.createWritable().then(function (w) {
        return w.write(raw).then(function () { return w.close(); });
      }).then(function () {
        writing = false;
        if (pending != null) { var p = pending; pending = null; return writeNow(p); }
      }).catch(function () { writing = false; ready = false; renderStatus(); });
    }
    function onSaveWrite(s, raw) { if (handle && ready) writeNow(raw); }
    function link() {
      if (!supported()) { toast('<i class="ti ti-alert-triangle"></i> File backup isn\'t supported in this browser.'); return; }
      return window.showSaveFilePicker({ suggestedName: "grand-line-backup.json", types: [{ description: "JSON", accept: { "application/json": [".json"] } }] }).then(function (h) {
        handle = h; ready = true;
        return idbSet(h).then(function () { return writeNow(JSON.stringify(save)); }).then(function () {
          renderStatus(); toast('<i class="ti ti-link"></i> Auto-backup linked — every change saves to your file.');
        });
      }).catch(function () {});
    }
    function unlink() {
      handle = null; ready = false;
      return idbDel().then(function () { renderStatus(); toast('<i class="ti ti-unlink"></i> Auto-backup unlinked.'); });
    }
    function restore() {
      if (typeof window.showOpenFilePicker !== "function") { toast('<i class="ti ti-alert-triangle"></i> Not supported here.'); return; }
      return window.showOpenFilePicker({ types: [{ description: "JSON", accept: { "application/json": [".json"] } }] }).then(function (arr) {
        return arr[0].getFile();
      }).then(function (f) { return f.text(); }).then(function (text) {
        var data = JSON.parse(text);
        if (!data || !data.player || !data.stats) throw new Error("bad");
        save = state.save(data); save = game.onLoad(save);
        $("#helmModal").hidden = true; show("quarters");
        toast('<i class="ti ti-upload"></i> Voyage restored from your file.');
      }).catch(function (e) { if (e && e.name !== "AbortError") toast('<i class="ti ti-alert-triangle"></i> Could not restore from that file.'); });
    }
    function reconnect() {
      if (!handle) return Promise.resolve();
      return verify(handle, true).then(function (ok) { ready = ok; renderStatus(); if (ok) return writeNow(JSON.stringify(save)); });
    }
    function init() {
      if (!supported()) { renderStatus(); return Promise.resolve(); }
      return idbGet().then(function (h) {
        if (h) { handle = h; return verify(h, false).then(function (ok) { ready = ok; }); }
      }).then(renderStatus).catch(renderStatus);
    }
    function renderStatus() {
      var st = $("#backupStatus");
      if (st) {
        st.textContent = !supported() ? "not supported in this browser"
          : (handle && ready) ? "on — every change saves to your file"
          : (handle && !ready) ? "linked — tap Reconnect to resume"
          : "off — your progress saves in this browser only";
      }
      var lk = $("#linkBackupBtn"), un = $("#unlinkBackupBtn"), rc = $("#reconnectBackupBtn");
      if (lk) lk.hidden = !supported() || !!handle;
      if (un) un.hidden = !handle;
      if (rc) rc.hidden = !(handle && !ready);
    }
    state.onSave(onSaveWrite);
    return { link: link, unlink: unlink, restore: restore, init: init, reconnect: reconnect, renderStatus: renderStatus, supported: supported,
      isLinked: function () { return !!handle && ready; },
      _setHandle: function (h) { handle = h; ready = true; }, _writeNow: writeNow };
  })();
  if (window.GL) window.GL.backup = backup;

  function applyTheme() {
    var t = economy.THEMES.find(function (x) { return x.id === save.player.activeTheme; }) || economy.THEMES[0];
    var root = document.documentElement.style;
    economy.THEMES.forEach(function (th) { Object.keys(th.vars).forEach(function (k) { root.removeProperty(k); }); });
    Object.keys(t.vars).forEach(function (k) { root.setProperty(k, t.vars[k]); });
  }

  function renderThemes() {
    var world = $("#themeListWorld"), fruit = $("#themeListFruit");
    if (world) world.innerHTML = "";
    if (fruit) fruit.innerHTML = "";
    economy.THEMES.forEach(function (t) {
      var list = (t.cat === "fruit") ? fruit : world;
      if (!list) return;
      var owned = save.player.ownedThemes.indexOf(t.id) !== -1;
      var active = save.player.activeTheme === t.id;
      var li = el("li");
      var sw = el("div", "theme-swatch");
      var palette = t.id === "grandline" ? ["#1b2a4a", "#f4ecd8", "#c8a24a", "#8a3b2e"]
        : [t.vars["--ocean-navy"], t.vars["--parchment"], t.vars["--bounty-gold"], t.vars["--wanted-red"]];
      palette.forEach(function (c) { var sq = el("div", "theme-sw"); sq.style.background = c; sw.appendChild(sq); });
      var info = el("div", "theme-info");
      var price = game.themePrice(save, t.cost); var discounted = price < t.cost; var priceHtml = (owned || t.cost === 0) ? '' : (discounted ? '  ·  <span class="price-was">฿' + fmt(t.cost) + '</span> <span class="price-now">฿' + fmt(price) + '</span>' : '  ·  ฿' + fmt(t.cost));
      info.innerHTML = '<div class="theme-name">' + t.name + '</div><div class="theme-desc">' + t.desc + priceHtml + '</div>';
      var btn = el("button", "theme-btn" + (active ? " active" : ""));
      if (active) { btn.textContent = "Active"; btn.disabled = true; }
      else if (owned) { btn.textContent = "Apply"; btn.onclick = function () { game.setActiveTheme(save, t.id); applyTheme(); renderHold(); renderHeader(); }; }
      else {
        var afford = save.player.berries >= price;
        btn.textContent = afford ? "Unlock" : "฿" + fmt(price - save.player.berries);
        btn.disabled = !afford;
        btn.onclick = function () { var r = game.buyTheme(save, t.id); if (r.ok) { game.setActiveTheme(save, t.id); applyTheme(); toast('<i class="ti ti-palette"></i> Unlocked the ' + r.theme.name + ' theme!', true); confetti(); announceItems(r.itemsEarned); renderHold(); renderHeader(); } };
      }
      li.appendChild(sw); li.appendChild(info); li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function renderInventory() {
    var wrap = $("#inventoryList"); if (!wrap) return;
    wrap.innerHTML = "";
    var inv = save.inventory || {};
    var intro = el("li", "crew-intro", "Provisions are earned, not bought \u2014 Marine Dispatches, new crewmates and spending \u0E3F in port all stock the stores.");
    wrap.appendChild(intro);
    var _disp=typeof currentDispatch==="function"?currentDispatch(save):null;
    economy.ITEM_KEYS.forEach(function (key) {
      var def = economy.ITEMS[key];
      var count = inv[key] || 0;
      var li = el("li", "item-card" + (count > 0 ? "" : " item-empty"));
      var info = el("div", "item-info");
      info.innerHTML = '<div class="item-name"><i class="ti ' + def.icon + '"></i> ' + def.name + ' <span class="item-count">×' + count + '</span></div>' +
        '<div class="item-blurb">' + def.blurb + '</div>' +
        (def.earn ? '<div class="crew-where"><i class="ti ti-map-pin"></i> Earn: ' + def.earn + '</div>' : '');
      if(!count&&_disp&&!_disp.state.done&&_disp.def.reward===key){var _cs=info.querySelector(".item-count");if(_cs)_cs.textContent=(_disp.state.progress||0)+"/"+_disp.def.need;}      var ctl;
      if (def.use === "passive") { ctl = el("span", "item-auto", "Auto"); ctl.title = "Used automatically"; }
      else {
        ctl = el("button", "item-use-btn", def.use === "instant" ? "Use" : "Activate");
        ctl.disabled = count <= 0;
        ctl.onclick = function () { doUseItem(key); };
      }
      li.appendChild(info); li.appendChild(ctl);
      wrap.appendChild(li);
    });
  }
  function doUseItem(key) {
    var r = game.useItem(save, key);
    if (r.error === "empty") return;
    if (r.error === "passive") { toast('<i class="ti ti-shield-half"></i> Streak Shield protects you automatically.'); return; }
    var def = economy.ITEMS[key];
    if (r.berries) toast('<i class="ti ' + def.icon + '"></i> ' + def.name + ': +' + fmt(r.berries) + ' ฿!', true);
    else if (r.armed) toast('<i class="ti ' + def.icon + '"></i> ' + def.name + ' armed — applies to your next action.', true);
    refreshAll();
  }
  function announceItems(keys) {
    (keys || []).forEach(function (key) {
      var def = economy.ITEMS[key];
      if (def) { toast('<i class="ti ' + def.icon + '"></i> Earned an item: ' + def.name + '!', true); confetti("#c8a24a"); }
    });
  }

  function renderHeader() {
    var p = save.player;
    $("#rankTitle").textContent = p.activeTitle ? (p.rankTitle + " · " + p.activeTitle) : p.rankTitle;
    $("#bountyNum").textContent = fmt(p.totalBounty);
    $("#berries").textContent = fmt(p.berries);
    var rk = economy.rankForBounty(p.totalBounty);
    $("#posterFace").textContent = RANK_FACE[rk.current.title] || "☠";
    $("#rankFill").style.width = rk.pct + "%";
    $("#rankNext").textContent = rk.next
      ? (fmt(rk.next.min - p.totalBounty) + " ฿ to " + rk.next.title)
      : "Highest bounty in history. You are the Pirate King. ☠";
    var chips = $("#buffChips"); chips.innerHTML = "";
    rewards.activeBuffs(save, state.todayStr()).forEach(function (b) {
      chips.appendChild(el("span", "buff-chip " + b.name, b.name === "morale" ? "Morale" : "Tailwind"));
    });
    var streak = rewards.voyageStreak(save, state.todayStr());
    if (streak > 1) chips.appendChild(el("span", "buff-chip", "🔥 " + streak + "d"));
    var _ai2 = save.activeItems || {};
    if (_ai2.xpSurge) chips.appendChild(el("span", "buff-chip item", "⚡ XP Surge"));
    if (_ai2.hakiFocus) chips.appendChild(el("span", "buff-chip item", "🔱 Haki Focus"));
    if (_ai2.logInsight) chips.appendChild(el("span", "buff-chip item", "💡 Log Insight"));
  }

  function renderHaki() {
    var grid = $("#hakiGrid"); grid.innerHTML = "";
    economy.STAT_KEYS.forEach(function (k) {
      var meta = economy.STATS[k], s = save.stats[k], lf = economy.levelFromXp(s.xp);
      var card = el("div", "haki");
      card.style.setProperty("--stat", accent(k));
      card.innerHTML =
        '<div class="haki-top"><span class="haki-name">' + meta.name + '</span>' +
        '<span class="haki-lvl">Lv ' + lf.level + '</span></div>' +
        '<div class="haki-sub">' + meta.haki + ' · ' + meta.area + '</div>' +
        '<div class="haki-bar"><div class="haki-bar-fill" style="width:' + lf.pct + '%"></div></div>' +
        '<div class="haki-xp">' + fmt(lf.into) + ' / ' + fmt(lf.need) + ' XP</div>';
      grid.appendChild(card);
    });
  }

  function renderTodayBand() {
    var today = state.todayStr();
    var band = $("#todayBand"), streakEl = $("#todayStreak"), statusEl = $("#todayStatus");
    band.classList.remove("at-risk");
    if (save.logPose[today]) {
      var st = rewards.voyageStreak(save, today);
      streakEl.innerHTML = '<i class="ti ti-flame"></i> ' + st + '-day course — locked in today ✓';
    } else {
      var prev = rewards.voyageStreak(save, rewards.addDays(today, -1));
      if (prev > 0) {
        band.classList.add("at-risk");
        streakEl.innerHTML = '<i class="ti ti-alert-triangle"></i> ' + prev + '-day course breaks tonight — log anything today to keep it';
      } else {
        streakEl.innerHTML = '<i class="ti ti-compass"></i> Set today\'s course — complete a bounty or log an entry to begin a streak';
      }
    }
    var openCount = save.bounties.filter(function (b) { return b.status === "open"; }).length;
    var bits = [openCount + " open bount" + (openCount === 1 ? "y" : "ies")];
    bits.push(game.todaysLog(save) ? "logged ✓" : "not logged yet");
    if (game.canRecap(save)) bits.push("Weekly Recap ready");
    statusEl.textContent = bits.join("  ·  ");
  }

  function renderQuickStatRow() {
    var row = $("#quickStatRow"); row.innerHTML = "";
    economy.STAT_KEYS.forEach(function (k) {
      var b = el("button", "quick-stat-dot" + (quickStat === k ? " sel" : ""), '<span class="qs-dot"></span>' + economy.STATS[k].name);
      b.style.setProperty("--stat", accent(k));
      b.title = economy.STATS[k].name + " (" + economy.STATS[k].area + ")";
      b.onclick = function () { quickStat = k; try { localStorage.setItem("gl.quickStat", k); } catch (e) {} renderQuickStatRow(); };
      row.appendChild(b);
    });
    var d = $("#quickStatDesc"); if (d) d.textContent = economy.STATS[quickStat].desc;
  }

  function renderQuarters() {
    renderTodayBand();
    renderDispatch();
    var sw = $("#streakWarn");
    if (sw) {
      var prevStreak = rewards.voyageStreak(save, rewards.addDays(state.todayStr(), -1));
      var atRisk = rewards.hasHaki(save, "streakWarn") && !save.logPose[state.todayStr()] && prevStreak > 0;
      sw.hidden = !atRisk;
      if (atRisk) sw.innerHTML = '<i class="ti ti-alert-triangle"></i> Your ' + prevStreak + '-day streak breaks tonight — log anything to keep it alive.';
    }
    renderQuickStatRow();
    var qlog = $("#quickLog"), qtoday = game.todaysLog(save);
    if (document.activeElement !== qlog) qlog.value = qtoday ? qtoday.text : "";
    $("#quickLogStatus").textContent = qtoday ? "logged today ✓" : "";
    var qprompt = economy.promptForDay(state.todayStr());
    $("#quickLogPrompt").textContent = qprompt; qlog.placeholder = qprompt;
    renderHaki();
    var pool = save.hakiPool || 0;
    var awakened = (save.player && save.player.hakiEarned) || 0;
    $("#hakiSummary").textContent = pool > 0
      ? pool + " Haki Point" + (pool > 1 ? "s" : "") + " ready to spend \u00B7 " + awakened + "/" + economy.HAKI_LIFETIME_CAP + " awakened"
      : (awakened >= economy.HAKI_LIFETIME_CAP
          ? "Your Haki is fully awakened \u2014 every point is spent or waiting."
          : awakened + "/" + economy.HAKI_LIFETIME_CAP + " points awakened. Level up any stat to awaken more.");
    var moodEntry = save.journal.find(function (e) { return e.type === "mood" && e.date === state.todayStr(); });
    $$("#weatherRow .weather-btn").forEach(function (b) {
      b.classList.toggle("sel", moodEntry && moodEntry.mood === b.dataset.mood);
    });
    var list = $("#quartersBounties"); list.innerHTML = "";
    var open = save.bounties.filter(function (b) { return b.status === "open"; }).slice(0, 6);
    if (!open.length) { list.appendChild(el("li", "empty", "No open bounties. Post one on the Board.")); }
    open.forEach(function (b) {
      var li = el("li");
      li.style.setProperty("--stat", accent(b.stat));
      var btn = el("button", "mini-check"); btn.title = "Complete"; btn.setAttribute("aria-label", "Complete " + b.title);
      btn.onclick = function () { doComplete(b.id); };
      li.appendChild(btn);
      li.appendChild(el("span", null, escapeHtml(b.title) + ' <span class="muted">(฿' + economy.TIERS[b.tier].berries + ')</span>'));
      list.appendChild(li);
    });
  }

  function renderDispatch() {
    var wrap = $("#dispatchCard"); if (!wrap) return;
    var d = game.currentDispatch(save);
    var def = d.def, st = d.state;
    var rewardDef = economy.ITEMS[def.reward];
    var prog = def.need > 1
      ? '<span class="dispatch-prog">' + Math.min(st.progress, def.need) + " / " + def.need + '</span>'
      : (st.done ? '<span class="dispatch-prog done">cleared</span>' : '<span class="dispatch-prog">not yet</span>');
    wrap.classList.toggle("done", !!st.done);
    wrap.innerHTML =
      '<div class="dispatch-head"><i class="ti ti-bell-ringing"></i> Marine Dispatch' +
        '<span class="dispatch-reward" title="Reward"><i class="ti ' + rewardDef.icon + '"></i> ' + rewardDef.name + '</span></div>' +
      '<div class="dispatch-body"><div class="dispatch-title">' + def.title + '</div>' +
        '<div class="dispatch-obj">' + def.objective + '</div></div>' +
      '<div class="dispatch-status">' + (st.done
        ? '<i class="ti ti-circle-check"></i> Reward claimed'
        : prog) + '</div>';
  }
  function syncStatDescs() {
    [["#bountyStat", "#bountyStatDesc"], ["#dutyStat", "#dutyStatDesc"]].forEach(function (p) {
      var sel = $(p[0]), d = $(p[1]);
      if (sel && d && economy.STATS[sel.value]) d.textContent = economy.STATS[sel.value].desc;
    });
  }

  function populateSelects() {
    var ss = $("#bountyStat"); if (ss.options.length) return;
    economy.STAT_KEYS.forEach(function (k) {
      var o = el("option"); o.value = k; o.textContent = economy.STATS[k].name + " (" + economy.STATS[k].area + ")"; ss.appendChild(o);
    });
    var ts = $("#bountyTier");
    economy.TIER_KEYS.forEach(function (k) {
      var o = el("option"); o.value = k; o.textContent = economy.TIERS[k].label + " · " + economy.TIERS[k].xp + " ฿"; ts.appendChild(o);
    });
    ts.value = "rookie";
    var fr = $("#bountyFilters");
    var mk = function (key, label) {
      var c = el("button", "chip" + (bountyFilter === key ? " active" : ""), label);
      c.onclick = function () { bountyFilter = key; renderBounties(); };
      return c;
    };
    fr.appendChild(mk("all", "All"));
    economy.STAT_KEYS.forEach(function (k) { fr.appendChild(mk(k, economy.STATS[k].name)); });
  }

  function renderBountyStatusFilters() {
    var fr = $("#bountyStatusFilters"); fr.innerHTML = "";
    [["open", "Open"], ["done", "Completed"], ["all", "All"]].forEach(function (o) {
      var c = el("button", "chip" + (bountyStatus === o[0] ? " active" : ""), o[1]);
      c.onclick = function () { bountyStatus = o[0]; renderBounties(); };
      fr.appendChild(c);
    });
  }

  function sortBounties(arr) {
    var a = arr.slice();
    if (bountySort === "due") {
      a.sort(function (x, y) { var dx = x.dueDate || "9999-99-99", dy = y.dueDate || "9999-99-99"; return dx < dy ? -1 : dx > dy ? 1 : 0; });
    } else if (bountySort === "tier") {
      a.sort(function (x, y) { return (TIER_ORDER[y.tier] || 0) - (TIER_ORDER[x.tier] || 0); });
    }
    return a;
  }

  function renderBountyStreakBanner() {
    var banner = $("#bountyStreakBanner"); if (!banner) return;
    var streak = rewards.taskStreak(save, state.todayStr());
    var cleared = save.player.bountiesCleared || 0;
    var next = economy.nextBountyMilestone(cleared);
    banner.classList.toggle("hot", streak > 0);
    var left = streak > 0
      ? '<span class="bsb-streak"><i class="ti ti-flame"></i> ' + streak + '-day bounty streak</span>'
      : '<span class="bsb-streak cold"><i class="ti ti-target"></i> Clear a bounty today to start a streak</span>';
    var right = next
      ? '<span class="bsb-next">' + cleared + ' / ' + next.count + ' cleared → <strong>' + next.title + '</strong></span>'
      : '<span class="bsb-next">' + cleared + ' cleared · top of the wanted list ☠</span>';
    banner.innerHTML = left + right;
    if (next) {
      var prev = 0;
      for (var i = 0; i < economy.BOUNTY_MILESTONES.length; i++) { if (economy.BOUNTY_MILESTONES[i].count === next.count) break; prev = economy.BOUNTY_MILESTONES[i].count; }
      var pct = Math.min(100, Math.round(((cleared - prev) / (next.count - prev)) * 100));
      banner.innerHTML += '<div class="bsb-bar"><div class="bsb-fill" style="width:' + pct + '%"></div></div>';
    }
  }

  function renderBounties() {
    populateSelects();
    syncStatDescs();
    renderBountyStatusFilters();
    renderBountyStreakBanner();
    $$("#bountyFilters .chip").forEach(function (c) {
      c.classList.toggle("active", c.textContent === (bountyFilter === "all" ? "All" : economy.STATS[bountyFilter].name));
    });
    $("#bountySort").value = bountySort;
    $("#clearCompletedBtn").hidden = save.bounties.filter(function (b) { return b.status === "done"; }).length === 0;
    var list = $("#bountyList"); list.innerHTML = "";
    var items = save.bounties.filter(function (b) {
      if (bountyStatus === "open" && b.status === "done") return false;
      if (bountyStatus === "done" && b.status !== "done") return false;
      return bountyFilter === "all" || b.stat === bountyFilter;
    });
    items = sortBounties(items);
    items.sort(function (a, b) { return (a.status === "done") - (b.status === "done"); });
    if (save.focusBountyId) items.sort(function (a, b) { return (b.id === save.focusBountyId ? 1 : 0) - (a.id === save.focusBountyId ? 1 : 0); });
    if (!items.length) {
      list.appendChild(el("li", "empty", bountyStatus === "done" ? "No completed bounties yet." : "No bounties here. Post one above."));
      return;
    }
    items.forEach(function (b) {
      if (editingBounty === b.id) { list.appendChild(bountyEditRow(b)); return; }
      var li = el("li", "bounty poster rarity-" + b.tier + (b.status === "done" ? " done" : ""));
      li.dataset.id = b.id;
      li.style.setProperty("--stat", accent(b.stat));
      var chk = el("button", "bounty-check" + (b.status === "done" ? " is-done" : ""),
        b.status === "done" ? '<i class="ti ti-check"></i>' : '<i class="ti ti-circle-check"></i><span class="chk-label">Clear</span>');
      chk.setAttribute("aria-label", b.status === "done" ? "Reopen bounty" : "Clear bounty");
      chk.title = b.status === "done" ? "Reopen bounty" : "Clear bounty";
      chk.onclick = function () { b.status === "done" ? doUncomplete(b.id) : doComplete(b.id); };
      var body = el("div", "bounty-body");
      var dueHtml = "";
      if (b.dueDate && b.status !== "done") {
        var overdue = b.dueDate < state.todayStr();
        dueHtml = '<span class="' + (overdue ? "due-over" : "due") + '"><i class="ti ti-calendar"></i> ' + (overdue ? "Overdue " : "Due ") + b.dueDate + '</span>';
      }
      var recurHtml = b.recurring ? '<span class="recur-badge"><i class="ti ti-repeat"></i> ' + b.recurring + '</span>' : "";
      var healthHtml = b.health ? '<span class="health-badge"><i class="ti ti-heart"></i> Health</span>' : "";
      body.innerHTML = '<div class="bounty-title"><i class="ti ' + (STAT_SIGIL[b.stat] || "ti-circle") + ' stat-sigil"></i>' + escapeHtml(b.title) + '</div>' +
        '<div class="bounty-meta"><span class="tier-badge tier-' + b.tier + '">' + economy.TIERS[b.tier].label + '</span>' +
        '<span>' + economy.STATS[b.stat].name + '</span>' + recurHtml + healthHtml + dueHtml + '</div>';
      var prev = rewards.hasHaki(save, "preview");
      var rw = prev ? rewards.previewReward(save, b.stat, b.tier) : { berries: economy.TIERS[b.tier].berries, xp: economy.TIERS[b.tier].xp };
      var reward = el("div", "bounty-reward" + (prev ? " previewed" : ""),
        '<span class="br-amount"><span class="br-sign">฿</span>' + fmt(rw.berries) + '</span>' +
        '<span class="br-xp">+' + rw.xp + ' XP</span>');
      var editBtn = el("button", "edit-btn", '<i class="ti ti-pencil"></i>'); editBtn.title = "Edit"; editBtn.setAttribute("aria-label", "Edit bounty");
      editBtn.onclick = function () { editingBounty = b.id; renderBounties(); };
      var del = el("button", "del-btn", '<i class="ti ti-x"></i>'); del.title = "Delete"; del.setAttribute("aria-label", "Delete bounty");
      del.onclick = function () { game.deleteBounty(save, b.id); renderBounties(); renderQuarters(); };
      var acts = el("div", "bounty-acts");
      if (b.status !== "done" && rewards.hasCrew(save, "sniper")) {
        var isFocus = save.focusBountyId === b.id;
        if (isFocus) li.classList.add("focused");
        var fbtn = el("button", "focus-btn" + (isFocus ? " on" : ""), '<i class="ti ti-crosshair"></i>');
        fbtn.title = isFocus ? "Focus Shot target — +25% reward on clear" : "Mark as Focus Shot target";
        fbtn.setAttribute("aria-label", fbtn.title);
        fbtn.onclick = function () { doFocus(b.id); };
        acts.appendChild(fbtn);
      }
      if (b.status !== "done" && rewards.hasHaki(save, "decree")) {
        var dToday = save.decree && save.decree.date === state.todayStr();
        var dOn = dToday && save.decree.bountyId === b.id;
        if (dOn) li.classList.add("decreed");
        var dbtn = el("button", "decree-btn" + (dOn ? " on" : ""), '<i class="ti ti-crown"></i>');
        dbtn.title = dOn ? "Decreed — x" + (rewards.hasHaki(save, "decreeBoost") ? 3 : 2) + " rewards" : (dToday ? "Decree used today" : "Decree this bounty");
        dbtn.setAttribute("aria-label", dbtn.title);
        if (dToday && !dOn) dbtn.disabled = true;
        dbtn.onclick = function () { doDecree(b.id); };
        acts.appendChild(dbtn);
      }
      acts.appendChild(editBtn); acts.appendChild(del);
      li.appendChild(chk); li.appendChild(body); li.appendChild(reward); li.appendChild(acts);
      list.appendChild(li);
    });
  }

  function bountyEditRow(b) {
    var li = el("li", "bounty"); li.style.setProperty("--stat", accent(b.stat));
    var box = el("div", "bounty-edit");
    var titleInput = el("input"); titleInput.type = "text"; titleInput.value = b.title; titleInput.maxLength = 120;
    var row = el("div", "bounty-edit-row");
    var statSel = el("select"); economy.STAT_KEYS.forEach(function (k) { var o = el("option"); o.value = k; o.textContent = economy.STATS[k].name; if (k === b.stat) o.selected = true; statSel.appendChild(o); });
    var tierSel = el("select"); economy.TIER_KEYS.forEach(function (k) { var o = el("option"); o.value = k; o.textContent = economy.TIERS[k].label; if (k === b.tier) o.selected = true; tierSel.appendChild(o); });
    row.appendChild(statSel); row.appendChild(tierSel);
    var actions = el("div", "bounty-edit-actions");
    var saveBtn = el("button", "mini-save", "Save");
    saveBtn.onclick = function () { var t = titleInput.value.trim(); if (!t) return; game.editBounty(save, b.id, { title: t, stat: statSel.value, tier: tierSel.value }); editingBounty = null; renderBounties(); };
    var cancelBtn = el("button", "mini-cancel", "Cancel");
    cancelBtn.onclick = function () { editingBounty = null; renderBounties(); };
    actions.appendChild(saveBtn); actions.appendChild(cancelBtn);
    box.appendChild(titleInput); box.appendChild(row); box.appendChild(actions);
    li.appendChild(box);
    setTimeout(function () { titleInput.focus(); }, 0);
    return li;
  }

  function populateDutySelects() {
    var ss = $("#dutyStat"); if (ss.options.length) return;
    economy.STAT_KEYS.forEach(function (k) {
      var o = el("option"); o.value = k; o.textContent = economy.STATS[k].name + " (" + economy.STATS[k].area + ")"; ss.appendChild(o);
    });
    var ts = $("#dutyTier");
    economy.TIER_KEYS.forEach(function (k) {
      var o = el("option"); o.value = k; o.textContent = economy.TIERS[k].label + " · " + economy.TIERS[k].xp + " ฿"; ts.appendChild(o);
    });
    ts.value = "petty";
  }

  function renderDuties() {
    populateDutySelects();
    syncStatDescs();
    var today = state.todayStr();
    renderWellnessCard();
    var list = $("#dutyList"); list.innerHTML = "";
    if (!save.habits.length) { list.appendChild(el("li", "empty", "No ship duties yet. Add a daily routine below.")); }
    save.habits.forEach(function (h) {
      var doneToday = h.lastCheckDate === today;
      var li = el("li", "duty poster rarity-" + h.tier + (doneToday ? " done" : ""));
      li.dataset.id = h.id;
      li.style.setProperty("--stat", accent(h.stat));
      var chk = el("button", "duty-check", doneToday ? '<i class="ti ti-check"></i>' : "");
      chk.title = doneToday ? "Done today" : "Check in";
      chk.setAttribute("aria-label", chk.title);
      chk.onclick = function () { doCheckHabit(h.id); };
      var body = el("div", "duty-body");
      var dutyHealth = h.health ? '<span class="health-badge"><i class="ti ti-heart"></i> Health</span>' : '';
      body.innerHTML = '<div class="duty-title"><i class="ti ' + (STAT_SIGIL[h.stat] || "ti-circle") + ' stat-sigil"></i>' + escapeHtml(h.title) + '</div>' +
        '<div class="duty-meta"><span>' + economy.STATS[h.stat].name + '</span>' + dutyHealth +
        (h.streak > 0 ? '<span class="duty-streak"><i class="ti ti-flame"></i> ' + h.streak + 'd</span>' : '') + '</div>';
      var reward = el("div", "bounty-reward",
        '<span class="br-amount"><span class="br-sign">฿</span>' + fmt(economy.TIERS[h.tier].berries) + '</span>' +
        '<span class="br-xp">+' + economy.TIERS[h.tier].xp + ' XP</span>');
      var del = el("button", "del-btn", '<i class="ti ti-x"></i>');
      del.title = "Delete"; del.setAttribute("aria-label", "Delete duty");
      del.onclick = function () { game.deleteHabit(save, h.id); renderDuties(); };
      li.appendChild(chk); li.appendChild(body); li.appendChild(reward); li.appendChild(del);
      list.appendChild(li);
    });
  }

  function renderLog() {
    var today = state.todayStr();
    renderLore();
    renderShipLog();
    renderVoyageMap();
    function tEntry(type) { return save.journal.find(function (e) { return e.type === type && e.date === today; }); }
    var mi = tEntry("morning_intent"), miEl = $("#morningIntent");
    if (document.activeElement !== miEl) miEl.value = mi ? mi.text : "";
    $("#intentStatus").textContent = mi ? "set ✓" : "";
    $("#intentPrompt").textContent = economy.morningPrompt(today);
    var er = tEntry("evening_reflection"), erEl = $("#eveningReflect");
    if (document.activeElement !== erEl) erEl.value = er ? er.text : "";
    $("#reflectStatus").textContent = er ? "logged ✓" : "";
    $("#reflectPrompt").textContent = economy.eveningPrompt(today);
    var fw = tEntry("free_write"), fwEl = $("#freeWrite");
    if (document.activeElement !== fwEl) fwEl.value = fw ? fw.text : "";
    $("#freeStatus").textContent = fw ? "saved ✓" : "";

    var insightBanner = $("#insightBanner");
    if (insightBanner) {
      if (save.activeItems && save.activeItems.logInsight) {
        insightBanner.hidden = false;
        insightBanner.innerHTML = '<i class="ti ti-bulb"></i> <strong>Log Insight active</strong> — your next entry earns +5 ฿. Bonus reflection: <em>' + economy.eveningPrompt(rewards.addDays(today, 1)) + '</em>';
      } else { insightBanner.hidden = true; }
    }

    var canRecap = game.canRecap(save);
    $("#saveRecapBtn").disabled = !canRecap;
    $("#recapText").disabled = !canRecap;
    $("#recapStatus").textContent = canRecap
      ? "Available now — reflect on your week for a big payout + Tailwind."
      : "Next recap in " + game.recapDaysLeft(save) + " day(s). Pace yourself, captain.";

    renderMoodStrip();
    renderJournalFilters();

    var feed = $("#journalFeed"); feed.innerHTML = "";
    var q = journalQuery.trim().toLowerCase();
    var items = save.journal.filter(function (e) {
      if (journalFilter !== "all" && e.type !== journalFilter) return false;
      if (journalDate && e.date !== journalDate) return false;
      if (q) { var hay = ((e.text || "") + " " + (e.mood || "")).toLowerCase(); if (hay.indexOf(q) === -1) return false; }
      return true;
    });
    if (!items.length) {
      feed.appendChild(el("li", "empty", save.journal.length ? "No entries match these filters." : "Your log is empty. Write your first entry above."));
    }
    items.slice(0, 80).forEach(function (e) {
      var li = el("li");
      var label = LOG_LABEL[e.type] || e.type;
      var text = e.type === "mood" ? ("Weather: " + e.mood) : escapeHtml(e.text);
      li.setAttribute('data-jtype', e.type);
      li.innerHTML = '<div class="jf-head"><i class="ti ' + (JF_ICON[e.type]||'ti-pencil') + ' jf-icon"></i><span class="jf-type">' + label + '</span><span class="jf-date">' + e.date + '</span></div>' +
        (text ? '<div class="jf-text">' + text + '</div>' : "");
      feed.appendChild(li);
    });
  }

  function renderJournalFilters() {
    var fr = $("#journalFilters"); fr.innerHTML = "";
    [["all", "All"], ["morning_intent", "Intent"], ["evening_reflection", "Reflection"], ["free_write", "Free Log"], ["captains_log", "Logs"], ["memory", "Memories"], ["mood", "Weather"], ["victory", "Victories"], ["recap", "Recaps"]].forEach(function (o) {
      var c = el("button", "chip" + (journalFilter === o[0] ? " active" : ""), o[1]);
      c.onclick = function () { journalFilter = o[0]; renderLog(); };
      fr.appendChild(c);
    });
  }

  function saveDaily(type, sel) {
    var text = $(sel).value.trim();
    if (!text) { toast('<i class="ti ti-pencil"></i> Write at least one line.'); return; }
    var ev = game.addJournal(save, type, { text: text });
    clearDraft(sel.replace("#", ""));
    if (ev && ev.updated) toast('<i class="ti ti-check"></i> Updated.');
    else if (ev) celebrate(ev);
    refreshAll();
  }

  function renderMoodStrip() {
    var strip = $("#moodStrip"); strip.innerHTML = "";
    var today = state.todayStr(), moods = {};
    save.journal.forEach(function (e) { if (e.type === "mood") moods[e.date] = e.mood; });
    var anyIn14=false;for(var ci=13;ci>=0;ci--){if(moods[rewards.addDays(today,-ci)]){anyIn14=true;break;}}if(!anyIn14){var ep=el('p');ep.className='muted';ep.style.cssText='text-align:center;padding:14px 4px;font-size:0.85em';ep.textContent='No weather logged yet — log Sunny, Cloudy, or Storm above to start tracking the sea.';strip.appendChild(ep);return;}
    for (var i = 13; i >= 0; i--) {
      var ds = rewards.addDays(today, -i), mood = moods[ds];
      var cell = el("div", "mood-cell" + (mood ? " " + mood : "") + (ds === today ? " today" : ""));
      cell.title = ds + (mood ? " · " + mood : " · no weather logged");
      cell.innerHTML = mood === "Sunny" ? '<i class="ti ti-sun"></i>' : mood === "Cloudy" ? '<i class="ti ti-cloud"></i>' : mood === "Storm" ? '<i class="ti ti-bolt"></i>' : '·';
      strip.appendChild(cell);
    }
  }

  function renderPose() {
    var now = new Date(); now.setMonth(now.getMonth() + poseOffset);
    var year = now.getFullYear(), month = now.getMonth();
    $("#poseMonth").textContent = now.toLocaleString("en", { month: "long", year: "numeric" });
    var grid = $("#poseGrid"); grid.innerHTML = "";
    ["S", "M", "T", "W", "T", "F", "S"].forEach(function (d) { grid.appendChild(el("div", "pose-cell dow", d)); });
    var first = new Date(year, month, 1).getDay();
    var days = new Date(year, month + 1, 0).getDate();
    for (var i = 0; i < first; i++) grid.appendChild(el("div", "pose-cell empty"));
    var today = state.todayStr();
    var hasAny = false;
    for (var d = 1; d <= days; d++) {
      var ds = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      var entry = save.logPose[ds];
      var cls = "pose-cell";
      if (entry) { cls += " visited"; if ((entry.tasksDone || 0) + (entry.journaled || 0) >= 3) cls += " full"; hasAny = true; }
      if (ds === today) cls += " today";
      if (ds === poseSelectedDay) cls += " sel";
      var cell = el("div", cls, String(d));
      cell.style.cursor = "pointer";
      (function (dsx) { cell.onclick = function () { poseSelectedDay = dsx; renderPose(); }; })(ds);
      grid.appendChild(cell);
    }
    if (!hasAny && poseOffset === 0) {
      grid.innerHTML += '<div class="empty-state" style="grid-column: 1 / -1;"><i class="ti ti-map-2"></i><h4>No voyage logged yet</h4><p>Complete a bounty or write a log entry to mark today on your Log Pose.</p></div>';
    }
    var loggedThisMonth = 0;
    for (var dd = 1; dd <= days; dd++) {
      var dsm = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
      if (save.logPose[dsm]) loggedThisMonth++;
    }
    $("#poseSummary").textContent = loggedThisMonth + " of " + days + " days logged this month";
    var streak = rewards.voyageStreak(save, today);
    $("#poseStreak").innerHTML = streak > 0
      ? '<i class="ti ti-flame"></i> ' + streak + '-day course locked on the Log Pose'
      : '<span class="muted">Log anything today to start your course.</span>';
    if (poseSelectedDay) renderDayDetail(poseSelectedDay);
    else $("#poseDayDetail").hidden = true;
  }

  function renderDayDetail(ds) {
    var panel = $("#poseDayDetail"); panel.hidden = false;
    var d = new Date(ds + "T00:00:00");
    var nice = d.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" });
    var entries = save.journal.filter(function (e) { return e.date === ds; });
    var done = save.bounties.filter(function (b) { return b.completedAt === ds || b.lastCompleted === ds; });
    var moodEntry = entries.filter(function (e) { return e.type === "mood"; })[0];
    var logs = entries.filter(function (e) { return e.type !== "mood"; });
    var html = '<div class="pdd-head">' + nice + '</div>';
    html += '<div class="pdd-sub">' + (moodEntry ? "Weather: " + moodEntry.mood + "  ·  " : "") + done.length + ' bount' + (done.length === 1 ? "y" : "ies") + ' cleared  ·  ' + logs.length + ' log entr' + (logs.length === 1 ? "y" : "ies") + '</div>';
    if (done.length) {
      html += '<div class="pdd-section">Bounties cleared</div><ul>';
      done.forEach(function (b) { html += '<li><span class="pdd-bounty-dot" style="background:' + accent(b.stat) + '"></span>' + escapeHtml(b.title) + '</li>'; });
      html += '</ul>';
    }
    if (logs.length) {
      html += '<div class="pdd-section">Logbook</div><ul>';
      logs.forEach(function (e) {
        var label = ({ captains_log: "Log", memory: "Memory", victory: "Victory", recap: "Recap" })[e.type] || e.type;
        html += '<li><span class="pdd-entry-type ' + e.type + '">' + label + '</span>' + escapeHtml(e.text || "") + '</li>';
      });
      html += '</ul>';
    }
    if (!done.length && !logs.length && !moodEntry) html += '<div class="empty">Nothing logged this day.</div>';
    panel.innerHTML = html;
  }

  /* ---------------- THE VAULT ---------------- */
  function renderVault() {
    var b = save.player.berries || 0;
    var bounty = save.player.totalBounty || 0;
    var vb = $("#vaultBerries"); if (vb) vb.textContent = fmt(b);
    var vbo = $("#vaultBounty"); if (vbo) vbo.textContent = fmt(bounty);
    var vt = $("#vaultTitle"); if (vt) vt.textContent = save.player.rankTitle || "—";
    var rk = economy.rankForBounty(bounty);
    var fill = $("#vaultTitleFill"); if (fill) fill.style.width = (rk.next ? rk.pct : 100) + "%";
    var nx = $("#vaultNext");
    if (nx) {
      var base = rk.next
        ? "Next title: " + rk.next.title + " — ฿" + fmt(rk.next.min - bounty) + " bounty to go"
        : "Highest title reached — King of the Pirates.";
      if (rk.next && rewards.hasHaki(save, "forecast")) {
        var wk = 0, td = state.todayStr();
        for (var i = 0; i < 7; i++) { var ld = save.logPose[rewards.addDays(td, -i)]; if (ld) wk += (ld.tasksDone || 0); }
        var daily = Math.max(40, Math.round(wk / 7 * 130) + 30);
        var days = Math.ceil((rk.next.min - bounty) / daily);
        base += "  ·  ~" + days + " day" + (days === 1 ? "" : "s") + " at your pace";
      }
      nx.textContent = base;
    }
  }

  /* ---------------- SPOILS: EPITHET TROPHIES ---------------- */
  function renderEpithets() {
    var wrap = $("#epithetList"); if (!wrap) return;
    wrap.innerHTML = "";
    var cleared = save.player.bountiesCleared || 0;
    var nextShown = false;
    economy.BOUNTY_MILESTONES.forEach(function (m) {
      var earned = cleared >= m.count;
      var isNext = !earned && !nextShown;
      if (isNext) nextShown = true;
      var reveal = earned || isNext;
      var icon = earned ? "ti-rosette" : isNext ? "ti-target-arrow" : "ti-lock";
      var li = el("li", "trophy" + (earned ? " earned" : isNext ? " next" : " locked"));
      li.innerHTML = '<div class="trophy-seal"><i class="ti ' + icon + '"></i></div>' +
        '<div class="trophy-info"><div class="trophy-title">' + (reveal ? m.title : "Rumored bounty") + '</div>' +
        '<div class="trophy-req">' + (earned ? "Earned · " + m.count + " cleared" : "Clear " + m.count + " (" + cleared + "/" + m.count + ")") + '</div></div>';
      wrap.appendChild(li);
    });
  }

  function renderHold() {
    renderVault();
    renderEpithets();
    var list = $("#shopList"); list.innerHTML = "";
    if (!save.shop.length) {
      list.innerHTML = '<div class="empty-state"><i class="ti ti-diamond"></i><h4>No rewards yet</h4><p>Add a personal reward to spend your Berries on.</p></div>';
    } else {
      save.shop.forEach(function (item) {
        var li = el("li", "shop-item");
        var days = Math.max(1, Math.ceil(item.cost / DAILY_EST));
        var afford = save.player.berries >= item.cost;
        li.innerHTML = '<div class="si-body"><div class="si-name">' + escapeHtml(item.name) + (item.owned ? ' ✓' : '') + '</div>' +
          '<div class="si-cost">฿' + fmt(item.cost) + '</div>' +
          '<div class="si-days">≈ ' + days + ' day' + (days > 1 ? "s" : "") + ' to afford</div></div>';
        var btn = el("button", "buy-btn", item.type === "cosmetic" && item.owned ? "Owned" : (afford ? "Claim" : "฿" + fmt(item.cost - save.player.berries)));
        btn.disabled = (item.type === "cosmetic" && item.owned) || !afford;
        btn.onclick = function () { doBuy(item.id); };
        var del = el("button", "del-btn", '<i class="ti ti-x"></i>');
        del.title = "Delete"; del.setAttribute("aria-label", "Delete shop item");
        del.onclick = function () { game.deleteShopItem(save, item.id); renderHold(); };
        li.appendChild(btn); li.appendChild(del);
        list.appendChild(li);
      });
    }
    var crew = $("#crewList"); crew.innerHTML = "";
    economy.CREW.forEach(function (def) {
      var c = save.crew.find(function (x) { return x.id === def.id; }) || {};
      var recruited = !!c.recruited;
      var afford = save.player.berries >= def.cost;
      var card = el("div", "crew-card" + (recruited ? " recruited" : ""));
      var btn = recruited
        ? '<button class="crew-recruit-btn" disabled>Recruited</button>'
        : '<button class="crew-recruit-btn" data-crew="' + def.id + '"' + (afford ? "" : " disabled") + '>Recruit</button>';
      var whereLine = def.where
        ? '<div class="crew-where">' + (recruited ? "Find it in: " : "Appears in: ") + escapeHtml(def.where) + '</div>'
        : '';
      card.innerHTML =
        '<div class="crew-wanted-header"><span class="crew-wanted-text">WANTED</span><span class="crew-wanted-sub">NAKAMA</span></div>' +
        '<div class="crew-icon-area"><i class="ti ti-' + CREW_ICON[def.id] + '"></i></div>' +
        '<div class="crew-name">' + escapeHtml(def.name) + '</div>' +
        '<div class="crew-bounty-box"><span class="crew-bounty-label">Bounty</span><span class="crew-bounty-amount">฿ ' + fmt(def.cost) + '</span></div>' +
        '<div class="crew-bonus">' + escapeHtml(def.bonus) + '</div>' +
        whereLine +
        btn;
      crew.appendChild(card);
    });
    $$("#crewList .crew-recruit-btn").forEach(function (b) {
      if (!b.disabled) b.onclick = function () { doRecruit(b.dataset.crew); };
    });
    renderThemes();
    renderInventory();
  }

  var selectedHaki = null;
  var HAKI_POS = { root: [50, 38], a1: [26, 122], a2: [26, 200], a3: [26, 278], b1: [74, 122], b2: [74, 200], b3: [74, 278], cap: [50, 352] };
  function renderHakiTrees() {
    var wrap = $("#hakiTrees"); wrap.innerHTML = "";
    var pool = save.hakiPool || 0;
    var awakened = (save.player && save.player.hakiEarned) || 0;
    var cap = economy.HAKI_LIFETIME_CAP;

    var banner = el("div", "card haki-pool");
    banner.innerHTML =
      '<div class="haki-pool-top"><span class="haki-pool-num"><i class="ti ti-bolt"></i> ' + pool + '</span>' +
      '<span class="haki-pool-label">Haki Point' + (pool === 1 ? "" : "s") + ' ready</span>' +
      '<span class="haki-pool-cap">' + awakened + ' / ' + cap + ' awakened</span></div>' +
      '<div class="haki-pool-bar"><div class="haki-pool-fill" style="width:' + Math.min(100, Math.round(awakened / cap * 100)) + '%"></div></div>' +
      '<p class="haki-pool-hint">Level-ups awaken points into one shared pool \u2014 it caps at ' + cap + ' for life. Mastering a single tree costs 32. Choose your Haki.</p>';
    wrap.appendChild(banner);

    economy.STAT_KEYS.forEach(function (k) {
      var meta = economy.HAKI_TREE_META[k] || {};
      var nodes = economy.HAKI_TREE[k];
      var spent = game.hakiSpent(save, k);
      var col = el("div", "haki-tree");
      col.style.setProperty("--stat", accent(k));
      col.innerHTML = '<div class="haki-tree-head"><span class="haki-tree-name">' + (meta.title || k) + '</span>' +
        '<span class="haki-pts">' + spent + ' / 32</span></div>';

      var graph = el("div", "haki-graph");
      var svg = '<svg class="haki-links" viewBox="0 0 100 380" preserveAspectRatio="none">';
      nodes.forEach(function (n) {
        (n.req || []).forEach(function (rid) {
          var p = nodes.find(function (x) { return x.id === rid; });
          if (!p) return;
          var a = HAKI_POS[p.pos], b = HAKI_POS[n.pos];
          var cls = save.haki[n.id] ? "lit" : (save.haki[rid] ? "ready" : "dim");
          svg += '<line class="' + cls + '" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" vector-effect="non-scaling-stroke"/>';
        });
      });
      svg += '</svg>';
      graph.innerHTML = svg;
      nodes.forEach(function (n) {
        var owned = !!save.haki[n.id];
        var reqOk = (n.req || []).every(function (rid) { return !!save.haki[rid]; });
        var stateCls = owned ? "owned" : (reqOk ? (pool >= n.cost ? "avail" : "reach") : "locked");
        var p = HAKI_POS[n.pos];
        var btn = el("button", "haki-nd " + stateCls + (selectedHaki === n.id ? " sel" : "") + (n.pos === "cap" ? " cap" : ""));
        btn.style.left = p[0] + "%"; btn.style.top = p[1] + "px";
        btn.innerHTML = '<i class="ti ' + n.icon + '"></i>' +
          (owned ? '<span class="haki-nd-cost done"><i class="ti ti-check"></i></span>'
                 : '<span class="haki-nd-cost">' + n.cost + '</span>');
        btn.title = n.name;
        btn.setAttribute("aria-label", n.name + (owned ? " (active)" : " (" + n.cost + " points)"));
        btn.onclick = function () { selectedHaki = n.id; renderHakiTrees(); };
        graph.appendChild(btn);
      });
      col.appendChild(graph);

      var detail = el("div", "haki-detail");
      var selNode = nodes.find(function (x) { return x.id === selectedHaki; });
      if (selNode) {
        var owned2 = !!save.haki[selNode.id];
        var reqOk2 = (selNode.req || []).every(function (rid) { return !!save.haki[rid]; });
        var status;
        if (owned2) {
          status = '<span class="haki-node-badge"><i class="ti ti-check"></i> Active</span>';
        } else if (!reqOk2) {
          var names = (selNode.req || []).filter(function (rid) { return !save.haki[rid]; })
            .map(function (rid) { var pn = nodes.find(function (x) { return x.id === rid; }); return pn ? pn.name : rid; });
          status = '<span class="haki-detail-lock"><i class="ti ti-lock"></i> Requires ' + names.join(" + ") + '</span>';
        } else {
          status = '<button class="haki-buy" data-node="' + selNode.id + '"' + (pool >= selNode.cost ? "" : " disabled") + '>Unlock \u00B7 ' + selNode.cost + ' pts</button>' +
            (pool >= selNode.cost ? "" : '<span class="haki-detail-lock">' + (selNode.cost - pool) + ' more point' + (selNode.cost - pool > 1 ? "s" : "") + ' needed</span>');
        }
        detail.innerHTML = '<div class="haki-node-name"><i class="ti ' + selNode.icon + '"></i> ' + selNode.name + '</div>' +
          '<div class="haki-node-desc">' + selNode.desc + '</div>' + status;
      } else {
        detail.innerHTML = '<div class="haki-node-desc haki-detail-blurb">' + (meta.blurb || "") + '</div>';
      }
      col.appendChild(detail);
      wrap.appendChild(col);
    });
    $$("#hakiTrees .haki-buy").forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); doUnlockHaki(b.dataset.node); };
    });
  }

  function doUnlockHaki(nodeId) {
    var r = game.unlockHakiNode(save, nodeId);
    if (r.error === "broke") toast('<i class="ti ti-lock"></i> Need ' + r.short + ' more Haki Point' + (r.short > 1 ? 's' : '') + '.');
    else if (r.error === "locked") toast('<i class="ti ti-lock"></i> Unlock the connected node first.');
    else if (r.ok) { toast('<i class="ti ti-bolt"></i> Haki unlocked: ' + r.node.name + ' \u2014 ' + r.node.desc, true); confetti(); announceItems(r.itemsEarned); }
    renderHakiTrees(); renderHeader();
  }

  function doComplete(id) {
    var b = save.bounties.find(function (x) { return x.id === id; });
    var ev = game.completeBounty(save, id);
    if (!ev) { refreshAll(); return; }
    if (ev.already) { toast('<i class="ti ti-clock"></i> Already cleared today.'); refreshAll(); return; }
    stampCard(id, b ? b.stat : "resolve");
    seaAudio.playSound("complete");
    if (ev.berries) { floatPop("+" + fmt(ev.berries) + " ฿", b ? b.stat : null); seaAudio.playSound("berry"); }
    if (b) clearedFlavor(b.stat, "bounty cleared");
    celebrate(ev);
    if (b) offerVictory(b.title);
    setTimeout(refreshAll, 620);
  }
  function doUncomplete(id) { game.uncompleteBounty(save, id); refreshAll(); }
  function doCheckHabit(id) {
    var h = save.habits.find(function (x) { return x.id === id; });
    var ev = game.checkHabit(save, id);
    if (!ev) { refreshAll(); return; }
    if (ev.already) { toast('<i class="ti ti-clock"></i> Already done today.'); refreshAll(); return; }
    stampCard(id, h ? h.stat : "resolve");
    seaAudio.playSound("complete");
    if (h) clearedFlavor(h.stat, "duty logged");
    celebrate(ev);
    setTimeout(refreshAll, 620);
  }
  function offerVictory(title) {
    toastAction('<i class="ti ti-confetti"></i> Bounty cleared! Log this win?', "Log it (+5 ฿)", function () {
      var ev = game.logVictory(save, title);
      celebrate(ev); refreshAll();
    });
  }
  function doBuy(id) {
    var r = game.buyReward(save, id);
    if (r.error === "broke") toast('<i class="ti ti-lock"></i> Need ฿' + fmt(r.short) + ' more.');
    else if (r.ok) { toast('<i class="ti ti-diamond"></i> Claimed: ' + escapeHtml(r.item.name) + '. Enjoy it, captain!', true); announceItems(r.itemsEarned); }
    refreshAll();
  }
  var CREW_NAV = { "Captain's Log": "log", "Captain's Log & the Hold": "log", "Bounty Board": "bounties", "Ship Duties": "duties", "The Helm (settings)": "helm" };
  var CREW_ICON = {
    swordsman: "sword", navigator: "compass", sniper: "crosshair", cook: "tools-kitchen-2",
    doctor: "first-aid-kit", archaeologist: "book", shipwright: "hammer", musician: "music", helmsman: "wheel"
  };
  function pulseNav(goto) {
    var b = document.querySelector('[data-goto="' + goto + '"]') || (goto === "helm" ? $("#helmBtn") : null);
    if (!b) return;
    b.classList.add("nav-pulse");
    setTimeout(function () { b.classList.remove("nav-pulse"); }, 6000);
  }
  function doRecruit(id) {
    var r = game.recruitCrew(save, id);
    if (r.error === "broke") { toast('<i class="ti ti-lock"></i> Need ฿' + fmt(r.short) + ' more to recruit.'); return; }
    if (r.error) return;
    var passive = !r.crew.where || r.crew.where.indexOf("Passive") === 0;
    var loc = passive ? '' : ' <span class="toast-where">Find it in <strong>' + r.crew.where + '</strong>.</span>';
    toast('<i class="ti ti-anchor"></i> <strong>' + r.crew.name + ' joined the crew!</strong> ' + r.crew.bonus + loc, true);
    seaAudio.playSound("recruit");
    confetti("#c8a24a");
    if (!passive) { var g = CREW_NAV[r.crew.where]; if (g) pulseNav(g); }
    announceItems(r.itemsEarned);
    refreshAll();
  }
  function doDecree(id) {
    var r = game.setDecree(save, id);
    if (r && r.ok) {
      toast('<i class="ti ti-crown"></i> Bounty decreed — it pays ×' + (rewards.hasHaki(save, "decreeBoost") ? 3 : 2) + ' rewards.', true);
      renderBounties();
    }
  }
  function doFocus(id) {
    var r = game.setFocus(save, id);
    if (r && r.ok) {
      if (r.focused) toast('<i class="ti ti-crosshair"></i> Focus Shot locked on — this bounty pays +25% when you clear it.');
      else toast('<i class="ti ti-crosshair"></i> Focus Shot released.');
      renderBounties();
    }
  }
  function renderWellnessCard() {
    var host = $("#wellnessCard"); if (!host) return;
    if (!rewards.hasCrew(save, "doctor")) { host.innerHTML = ""; return; }
    var week = game.wellnessWeek(save);
    var healthDuties = (save.habits || []).filter(function (h) { return h.health; });
    var rows = healthDuties.map(function (h) {
      return '<div class="wellness-row"><span>' + escapeHtml(h.title) + '</span>' +
        '<span class="health-badge"><i class="ti ti-flame"></i> ' + (h.streak || 0) + 'd</span></div>';
    }).join("");
    host.innerHTML = '<div class="card wellness-card">' +
      '<div class="card-head"><i class="ti ti-heartbeat"></i> Wellness <span class="muted">Doctor aboard</span></div>' +
      '<div class="wellness-count"><span class="wellness-big">' + week + '</span> health check-in' + (week === 1 ? '' : 's') + ' this week</div>' +
      (rows || '<p class="muted">Tag a duty or bounty as a Health routine to track it here.</p>') +
      '</div>';
  }

  function renderLore() {
    var host = $("#loreCard"); if (!host) return;
    if (!rewards.hasCrew(save, "archaeologist")) { host.innerHTML = ""; return; }
    host.innerHTML = '<div class="card lore-card"><div class="card-head"><i class="ti ti-book-2"></i> Poneglyph of the Day</div>' +
      '<p class="lore-text">' + escapeHtml(economy.loreForDay(state.todayStr())) + '</p></div>';
  }

  function renderShipLog() {
    var host = $("#shipLogCard"); if (!host) return;
    if (!rewards.hasCrew(save, "shipwright")) { host.innerHTML = ""; return; }
    var s = game.shipLog(save);
    host.innerHTML = '<div class="card shiplog-card"><div class="card-head"><i class="ti ti-tools"></i> Ship\'s Logbook <span class="muted">this week</span></div>' +
      '<div class="shiplog-grid">' +
        '<div class="shiplog-stat"><span class="sl-num">' + s.activeDays + '</span><span class="sl-lbl">active days</span></div>' +
        '<div class="shiplog-stat"><span class="sl-num">' + s.bounties + '</span><span class="sl-lbl">bounties cleared</span></div>' +
        '<div class="shiplog-stat"><span class="sl-num">' + s.journals + '</span><span class="sl-lbl">log entries</span></div>' +
        '<div class="shiplog-stat"><span class="sl-num">' + s.currentStreak + 'd</span><span class="sl-lbl">current streak</span></div>' +
        '<div class="shiplog-stat"><span class="sl-num">' + s.longestStreak + 'd</span><span class="sl-lbl">longest ever</span></div>' +
      '</div></div>';
  }

  function renderVoyageMap() {
    var host = $("#voyageMapCard"); if (!host) return;
    if (!rewards.hasCrew(save, "navigator")) { host.innerHTML = ""; return; }
    var today = state.todayStr();
    var WEEKS = 12, cells = "";
    var series = [];
    for (var i = WEEKS * 7 - 1; i >= 0; i--) {
      var d = rewards.addDays(today, -i);
      var lp = save.logPose[d];
      var n = lp ? ((lp.tasksDone || 0) + (lp.journaled || 0)) : 0;
      series.push({ date: d, n: n });
    }
    series.forEach(function (c) {
      var lvl = c.n === 0 ? 0 : (c.n >= 5 ? 4 : (c.n >= 3 ? 3 : (c.n >= 2 ? 2 : 1)));
      cells += '<span class="vm-cell vm-l' + lvl + '" title="' + c.date + ' · ' + c.n + ' action' + (c.n === 1 ? '' : 's') + '"></span>';
    });
    host.innerHTML = '<div class="card voyage-card"><div class="card-head"><i class="ti ti-map-2"></i> Voyage Map <span class="muted">last 12 weeks</span></div>' +
      '<div class="voyage-grid">' + cells + '</div>' +
      '<div class="voyage-legend"><span>Calm</span><span class="vm-cell vm-l0"></span><span class="vm-cell vm-l1"></span><span class="vm-cell vm-l2"></span><span class="vm-cell vm-l3"></span><span class="vm-cell vm-l4"></span><span>Storm</span></div>' +
      '</div>';
  }

  function celebrate(ev) {
    if (ev.already) { toast('<i class="ti ti-clock"></i> Already done today.'); return; }
    var bits = [];
    if (ev.berries) bits.push("+" + fmt(ev.berries) + " ฿");
    if (ev.xp) bits.push("+" + fmt(ev.xp) + " XP");
    if (ev.bountyGain) bits.push("+" + fmt(ev.bountyGain) + " bounty");
    if (bits.length) toast('<i class="ti ti-coin"></i> ' + bits.join("  ·  "));
    if (ev.focusShot) toast('<i class="ti ti-crosshair"></i> Focus Shot hit! +25% reward on the target.');
    if (ev.cookBonus) toast('<i class="ti ti-flame"></i> Cook\'s galley: +' + fmt(ev.cookBonus) + ' ฿ for a health mission.');
    if (ev.doctorXp) toast('<i class="ti ti-heartbeat"></i> Doctor\'s orders: +' + ev.doctorXp + ' Strength XP.');
    if (ev.setSail) toast('<i class="ti ti-sailboat"></i> Set Sail bonus! +' + (ev.setSailAmount || 10) + ' ฿');
    if (ev.recurredTo) toast('<i class="ti ti-repeat"></i> Repeats — next due ' + ev.recurredTo);
    if (ev.habitStreak) { toast('<i class="ti ti-flame"></i> ' + ev.habitStreak + '-day Ship Duty streak'); seaAudio.playSound("streak"); }
    if (ev.hakiPointsGained) { toast('<i class="ti ti-bolt"></i> +' + ev.hakiPointsGained + ' Haki Point' + (ev.hakiPointsGained > 1 ? 's' : '') + ' awakened \u2014 spend them in the Haki trees', true); pulseNav('haki'); }
    if (ev.buffGranted === "morale") toast('<i class="ti ti-mood-smile"></i> Morale up: +10% Berries tomorrow');
    if (ev.buffGranted === "tailwind") toast('<i class="ti ti-wind"></i> Tailwind: +15% XP for 3 days');
    (ev.leveledUp || []).forEach(function (l) {
      toast('<i class="ti ti-arrow-up-circle"></i> ' + economy.STATS[l.stat].name + ' reached Level ' + l.level + '!', true);
      seaAudio.playSound("levelup");
      confetti();
    });
    if (ev.rankUp) { toast('<i class="ti ti-crown"></i> New title: ' + ev.rankUp.title + '! — ' + ev.rankUp.vibe, true); confetti(); }
    (ev.crewUnlocked || []).forEach(function (c) {
      toast('<i class="ti ti-users"></i> Unlocked: ' + c.name + ' — ' + c.bonus, true);
      confetti();
    });
    if (ev.bountyMilestone) {
      toast('<i class="ti ti-trophy"></i> Most Wanted: ' + ev.bountyMilestone.title + '!  +' + fmt(ev.bountyMilestone.bonus) + ' ฿', true);
      confetti("#8a3b2e");
    }
    if (ev.xpSurged) toast('<i class="ti ti-flame"></i> XP Surge spent — double XP!');
    if (ev.hakiFocusBonus) toast('<i class="ti ti-bolt"></i> Haki Focus spent — +' + ev.hakiFocusBonus + ' bonus Haki Point' + (ev.hakiFocusBonus > 1 ? "s" : "") + '!');
    if (ev.logInsightBonus) toast('<i class="ti ti-bulb"></i> Log Insight — +' + ev.logInsightBonus + ' ฿');
    if (ev.dispatchProgress) toast('<i class="ti ti-bell-ringing"></i> Marine Dispatch — ' + ev.dispatchProgress.progress + ' / ' + ev.dispatchProgress.def.need);
    if (ev.dispatchCleared) {
      var rd = economy.ITEMS[ev.dispatchCleared.reward];
      toast('<i class="ti ti-bell-ringing"></i> Dispatch cleared! Earned ' + rd.name, true);
      confetti("#3f7fbf");
    }
    if (ev.decreed) toast('<i class="ti ti-crown"></i> Decree fulfilled — ×' + ev.decreed + ' rewards!', true);
    if (ev.comeback) toast('<i class="ti ti-flame"></i> Comeback clear — bonus XP for returning!');
    if (ev.backToBack) toast('<i class="ti ti-bolt"></i> Back-to-back — +' + ev.backToBack + ' ฿');
    if (ev.weeklyOutput) { toast('<i class="ti ti-crown"></i> Supreme King payout — +' + fmt(ev.weeklyOutput.berries) + ' ฿!', true); confetti(); }
    announceItems(ev.itemsEarned);
  }

  function toast(html, big) {
    var t = el("div", "toast" + (big ? " big" : ""), html);
    $("#toastWrap").appendChild(t);
    setTimeout(function () { t.remove(); }, 2800);
  }

  function toastAction(html, label, onAction) {
    var t = el("div", "toast action");
    t.innerHTML = '<span>' + html + '</span>';
    var btn = el("button", "toast-btn", label);
    var done = false;
    btn.onclick = function () { if (done) return; done = true; onAction(); t.remove(); };
    t.appendChild(btn);
    $("#toastWrap").appendChild(t);
    setTimeout(function () { t.remove(); }, 6000);
  }

  function confetti(accentHex) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var colors = accentHex
      ? [accentHex, "#c8a24a", "#fffdf6", accentHex, "#fff"]
      : ["#c8a24a", "#8a3b2e", "#2e6e6a", "#1b2a4a", "#e8a0a8"];
    var layer = $("#confettiLayer");
    for (var i = 0; i < 60; i++) {
      var c = el("div", "confetti");
      c.style.left = Math.random() * 100 + "%";
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = (1.6 + Math.random() * 1.4) + "s";
      c.style.animationDelay = (Math.random() * 0.3) + "s";
      if (Math.random() > .5) c.style.borderRadius = "50%";
      layer.appendChild(c);
      (function (node) { setTimeout(function () { node.remove(); }, 3200); })(c);
    }
  }

  function floatPop(text, stat) {
    var layer = $("#confettiLayer") || document.body;
    var pop = el("div", "float-pop", text);
    if (stat) pop.style.setProperty("--stat", accent(stat));
    layer.appendChild(pop);
    setTimeout(function () { pop.remove(); }, 750);
  }

  function stampCard(id, stat) {
    var li = $('#bountyList li[data-id="' + id + '"]') || $('#dutyList li[data-id="' + id + '"]');
    if (!li) return;
    li.classList.add("just-cleared");
    var st = el("div", "clear-stamp", "CLEARED");
    st.style.setProperty("--stat", accent(stat));
    li.appendChild(st);
  }
  function clearedFlavor(stat, suffix) {
    var flavor = STAT_FLAVOR[stat] || "Cleared.";
    toast('<i class="ti ti-confetti"></i> ' + flavor + ' — ' + economy.STATS[stat].name + ' ' + suffix, true);
    confetti(accent(stat));
  }

  var lastFocused = null;
  function showConfirm(title, msg, yesLabel, onYes) {
    $("#confirmTitle").innerHTML = '<i class="ti ti-alert-triangle" aria-hidden="true"></i> ' + title;
    $("#confirmMsg").textContent = msg;
    $("#confirmYes").textContent = yesLabel || "Confirm";
    pendingConfirm = onYes;
    lastFocused = document.activeElement;
    $("#confirmModal").hidden = false;
    setTimeout(function () { $("#confirmYes").focus(); }, 0);
  }

  function show(screen) {
    var changed = current !== screen;
    current = screen;
    $$(".screen").forEach(function (s) { s.hidden = s.dataset.screen !== screen; });
    $$(".tab").forEach(function (t) {
      var active = t.dataset.goto === screen;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active);
    });
    renderScreen();
    if (changed) {
      var sec = document.querySelector('.screen[data-screen="' + screen + '"]');
      if (sec) {
        sec.classList.remove("screen-anim");
        void sec.offsetWidth;
        sec.classList.add("screen-anim");
      }
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function renderScreen() {
    if (current === "quarters") renderQuarters();
    else if (current === "bounties") renderBounties();
    else if (current === "duties") renderDuties();
    else if (current === "log") renderLog();
    else if (current === "pose") renderPose();
    else if (current === "hold") renderHold();
    else if (current === "haki") renderHakiTrees();
    restoreDrafts();
  }

  function refreshAll() { renderHeader(); renderScreen(); (function(){var hn=document.querySelector('[data-goto="haki"]');if(hn&&typeof save!=="undefined"&&save)hn.classList.toggle("haki-has-points",!!(save.hakiPool));})(); }

  var seaAudio = (function () {
    var ctx = null, ambientEl = null;
    function ensure() {
      if (ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    function start() {
      if (!rewards.hasCrew(save, "musician")) return;
      if (!ambientEl) {
        // Prefer mp3 (Safari/iOS can't decode Ogg Vorbis); fall back to the ogg
        // source, which is the only one confirmed to exist, if the mp3 errors out.
        ambientEl = new Audio("audio/ocean.mp3");
        ambientEl.addEventListener("error", function onMp3Error() {
          ambientEl.removeEventListener("error", onMp3Error);
          ambientEl.src = "audio/ocean.ogg";
          ambientEl.play().catch(function () {});
        });
        ambientEl.loop = true;
        ambientEl.volume = Math.max(0, Math.min(1, (save.audioVolume == null ? 40 : save.audioVolume) / 100));
      }
      ambientEl.play().catch(function () {});
      save.audioOn = true;
      state.save(save);
      refreshAudioBtn();
    }
    function stop() {
      if (ambientEl) { ambientEl.pause(); ambientEl.currentTime = 0; }
      save.audioOn = false;
      state.save(save);
      refreshAudioBtn();
    }
    function setVolume(v) {
      if (ambientEl) ambientEl.volume = Math.max(0, Math.min(1, v / 100));
    }
    function sfxEnabled() {
      return !(typeof save !== "undefined" && save && save.sfxEnabled === false);
    }
    function sfxGain(dest) {
      var g = ctx.createGain(); g.gain.value = 0; g.connect(dest || ctx.destination);
      return g;
    }
    function playSound(type) {
      if (!sfxEnabled()) return;
      ensure(); if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      var t = ctx.currentTime;
      if (type === "complete") {
        [440, 440].forEach(function (f, i) {
          var o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(f, t);
          o.frequency.linearRampToValueAtTime(880, t + 0.15);
          var g = sfxGain(); g.gain.setValueAtTime(0.3, t); g.gain.linearRampToValueAtTime(0, t + 0.3);
          o.connect(g); o.detune.value = i * 4; o.start(t); o.stop(t + 0.3);
        });
      } else if (type === "levelup") {
        [523.25, 659.25, 783.99].forEach(function (f, i) {
          var start = t + i * 0.1;
          var o = ctx.createOscillator(); o.type = "square"; o.frequency.value = f;
          var g = sfxGain(); g.gain.setValueAtTime(0.2, start); g.gain.linearRampToValueAtTime(0, start + 0.1);
          o.connect(g); o.start(start); o.stop(start + 0.1);
        });
      } else if (type === "recruit") {
        [261, 329, 392].forEach(function (f) {
          var o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
          var g = sfxGain(); g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.25, t + 0.02);
          g.gain.linearRampToValueAtTime(0, t + 0.5);
          o.connect(g); o.start(t); o.stop(t + 0.5);
        });
      } else if (type === "berry") {
        var o = ctx.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(1200, t); o.frequency.linearRampToValueAtTime(800, t + 0.2);
        var g = sfxGain(); g.gain.setValueAtTime(0.4, t); g.gain.linearRampToValueAtTime(0, t + 0.2);
        o.connect(g); o.start(t); o.stop(t + 0.2);
      } else if (type === "streak") {
        var o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = 523;
        var lfo = ctx.createOscillator(); lfo.frequency.value = 6;
        var lfoGain = ctx.createGain(); lfoGain.gain.value = 5;
        lfo.connect(lfoGain); lfoGain.connect(o2.frequency);
        var g2 = sfxGain(); g2.gain.setValueAtTime(0.3, t); g2.gain.linearRampToValueAtTime(0, t + 0.6);
        o2.connect(g2); o2.start(t); o2.stop(t + 0.6);
        lfo.start(t); lfo.stop(t + 0.6);
      }
    }
    return { start: start, stop: stop, isPlaying: function () { return !!(ambientEl && !ambientEl.paused); }, setVolume: setVolume, playSound: playSound };
  })();

  function refreshAudioBtn() {
    var b = $("#audioBtn"); if (!b) return;
    var has = rewards.hasCrew(save, "musician");
    b.hidden = !has;
    b.innerHTML = '<i class="ti ti-music"></i> Sea ambient: ' + (save.audioOn ? "on" : "off");
    b.classList.toggle("on", !!save.audioOn);
    var row = $("#audioVolumeRow"); if (row) row.hidden = !has;
    var slider = $("#audioVolumeSlider"), label = $("#audioVolumeLabel");
    var vol = save.audioVolume == null ? 40 : save.audioVolume;
    if (slider) slider.value = vol;
    if (label) label.textContent = vol + "%";
  }

  function refreshSfxBtn() {
    var b = $("#sfxBtn"); if (!b) return;
    b.innerHTML = '<i class="ti ti-bell-ringing"></i> Sound effects: ' + (save.sfxEnabled ? "on" : "off");
    b.classList.toggle("on", !!save.sfxEnabled);
  }

  function doExportBackup() {
    var blob = new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = el("a"); a.href = url; a.download = "grand-line-backup-" + state.todayStr() + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('<i class="ti ti-download"></i> Backup saved.');
    try { localStorage.setItem("gl.backupNudgeDone", "1"); } catch (e) {}
  }

  function wire() {
    $$("[data-goto]").forEach(function (b) { b.onclick = function () { show(b.dataset.goto); }; });
    var _hb = $("#helmBtn"); if (_hb) _hb.addEventListener("click", function () { refreshAudioBtn(); refreshSfxBtn(); });
    var audioBtn = $("#audioBtn");
    if (audioBtn) audioBtn.onclick = function () {
      if (save.audioOn) seaAudio.stop(); else seaAudio.start();
    };
    if (save.audioOn && rewards.hasCrew(save, "musician")) {
      var _resume = function () { seaAudio.start(); document.removeEventListener("pointerdown", _resume); };
      document.addEventListener("pointerdown", _resume);
    }
    var volSlider = $("#audioVolumeSlider"), volLabel = $("#audioVolumeLabel");
    if (volSlider) {
      volSlider.oninput = function () {
        var v = parseInt(this.value, 10);
        save.audioVolume = v; state.save(save);
        if (volLabel) volLabel.textContent = v + "%";
        seaAudio.setVolume(v);
      };
    }
    refreshSfxBtn();
    var sfxBtn = $("#sfxBtn");
    if (sfxBtn) sfxBtn.onclick = function () {
      save.sfxEnabled = !save.sfxEnabled; state.save(save);
      refreshSfxBtn();
    };

    $("#addBountyForm").onsubmit = function (e) {
      e.preventDefault();
      var title = $("#bountyTitle").value.trim(); if (!title) return;
      var bHealth = $("#bountyHealth") && $("#bountyHealth").checked;
      game.addBounty(save, title, $("#bountyStat").value, $("#bountyTier").value, $("#bountyDue").value || null, $("#bountyRecurring").value || null, bHealth);
      $("#bountyTitle").value = ""; $("#bountyDue").value = ""; $("#bountyRecurring").value = ""; if ($("#bountyHealth")) $("#bountyHealth").checked = false; clearDraft("bountyTitle");
      renderBounties();
    };
    if ($("#bountyStat")) $("#bountyStat").onchange = syncStatDescs;
    if ($("#dutyStat")) $("#dutyStat").onchange = syncStatDescs;

    $$("#weatherRow .weather-btn").forEach(function (b) {
      b.onclick = function () {
        var existing = save.journal.find(function (e) { return e.type === "mood" && e.date === state.todayStr(); });
        if (existing) { existing.mood = b.dataset.mood; state.save(save); }
        else { var ev = game.addJournal(save, "mood", { mood: b.dataset.mood }); celebrate(ev); }
        refreshAll();
      };
    });

    $("#saveIntentBtn").onclick = function () { saveDaily("morning_intent", "#morningIntent"); };
    $("#saveReflectBtn").onclick = function () { saveDaily("evening_reflection", "#eveningReflect"); };
    $("#saveFreeBtn").onclick = function () { saveDaily("free_write", "#freeWrite"); };

    $("#quickBountyForm").onsubmit = function (e) {
      e.preventDefault();
      var t = $("#quickBountyTitle").value.trim(); if (!t) return;
      game.addBounty(save, t, quickStat, "rookie");
      $("#quickBountyTitle").value = ""; clearDraft("quickBountyTitle");
      toast('<i class="ti ti-flag"></i> Bounty posted to ' + economy.STATS[quickStat].name + '.');
      refreshAll();
    };
    $("#quickLogSave").onclick = function () {
      var text = $("#quickLog").value.trim();
      if (!text) { toast('<i class="ti ti-pencil"></i> Write at least one line.'); return; }
      var ev = game.addJournal(save, "captains_log", { text: text });
      clearDraft("quickLog");
      if (ev.updated) toast('<i class="ti ti-check"></i> Log updated.');
      else celebrate(ev);
      refreshAll();
    };
    $("#quickMemoryForm").onsubmit = function (e) {
      e.preventDefault();
      var text = $("#quickMemoryText").value.trim(); if (!text) return;
      var ev = game.addJournal(save, "memory", { text: text });
      $("#quickMemoryText").value = ""; clearDraft("quickMemoryText");
      celebrate(ev); refreshAll();
    };


    $("#addDutyForm").onsubmit = function (e) {
      e.preventDefault();
      var title = $("#dutyTitle").value.trim(); if (!title) return;
      var dHealth = $("#dutyHealth") && $("#dutyHealth").checked;
      game.addHabit(save, title, $("#dutyStat").value, $("#dutyTier").value, dHealth);
      $("#dutyTitle").value = ""; if ($("#dutyHealth")) $("#dutyHealth").checked = false;
      renderDuties();
    };

    $("#saveRecapBtn").onclick = function () {
      var text = $("#recapText").value.trim();
      var ev = game.addJournal(save, "recap", { text: text || "(weekly recap)" });
      if (ev.locked) { toast('<i class="ti ti-lock"></i> Recap recharges in ' + ev.daysLeft + ' day(s).'); return; }
      $("#recapText").value = ""; clearDraft("recapText");
      celebrate(ev); refreshAll();
    };

    $("#addShopForm").onsubmit = function (e) {
      e.preventDefault();
      var name = $("#shopName").value.trim(), cost = parseInt($("#shopCost").value, 10);
      if (!name || !cost) return;
      game.addShopItem(save, name, cost, "reward");
      $("#shopName").value = ""; $("#shopCost").value = "";
      renderHold();
    };

    $("#poseControlPrev").onclick = function () { poseOffset--; poseSelectedDay = null; renderPose(); };
    $("#poseControlNext").onclick = function () { poseOffset++; poseSelectedDay = null; renderPose(); };

    $("#journalSearch").oninput = function () { journalQuery = this.value; renderLog(); };
    $("#journalDate").onchange = function () { journalDate = this.value; renderLog(); };
    $("#journalDateClear").onclick = function () { journalDate = ""; $("#journalDate").value = ""; renderLog(); };

    DRAFT_FIELDS.forEach(function (id) {
      var x = document.getElementById(id);
      if (x) x.addEventListener("input", function () { setDraft(id, x.value); });
    });
    if ($("#linkBackupBtn")) $("#linkBackupBtn").onclick = function () { backup.link(); };
    if ($("#unlinkBackupBtn")) $("#unlinkBackupBtn").onclick = function () { backup.unlink(); };
    if ($("#reconnectBackupBtn")) $("#reconnectBackupBtn").onclick = function () { backup.reconnect(); };
    if ($("#restoreBackupBtn")) $("#restoreBackupBtn").onclick = function () { backup.restore(); };

    $("#bountySort").onchange = function () { bountySort = this.value; renderBounties(); };
    $("#clearCompletedBtn").onclick = function () {
      showConfirm("Clear completed?", "This removes all completed bounties from the board. Your Bounty score and history stay intact.", "Clear", function () {
        var n = game.clearCompleted(save);
        toast('<i class="ti ti-trash"></i> Cleared ' + n + ' completed bount' + (n === 1 ? "y" : "ies") + '.');
        renderBounties();
      });
    };

    $("#confirmNo").onclick = function () { $("#confirmModal").hidden = true; pendingConfirm = null; if (lastFocused) lastFocused.focus(); };
    $("#confirmYes").onclick = function () { var cb = pendingConfirm; $("#confirmModal").hidden = true; pendingConfirm = null; if (cb) cb(); if (lastFocused) lastFocused.focus(); };

    var helmLastFocused = null;
    $("#helmBtn").onclick = function () { helmLastFocused = document.activeElement; $("#helmModal").hidden = false; setTimeout(function () { $("#closeHelm").focus(); }, 0); };
    $("#closeHelm").onclick = function () { $("#helmModal").hidden = true; if (helmLastFocused) helmLastFocused.focus(); };

    $("#exportBtn").onclick = doExportBackup;
    $("#importBtn").onclick = function () { $("#importFile").click(); };
    $("#importFile").onchange = function (e) {
      var file = e.target.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          if (!data || !data.player || !data.stats) throw new Error("bad");
          save = state.save(data); save = game.onLoad(save);
          $("#helmModal").hidden = true; show("quarters");
          toast('<i class="ti ti-upload"></i> Voyage restored.');
        } catch (err) { toast('<i class="ti ti-alert-triangle"></i> That file is not a valid backup.'); }
        e.target.value = "";
      };
      reader.readAsText(file);
    };
    $("#resetBtn").onclick = function () {
      $("#helmModal").hidden = true;
      showConfirm("Scuttle the ship?", "This wipes ALL progress and cannot be undone.", "Scuttle it", function () {
        save = state.reset(); save = game.onLoad(save);
        show("quarters");
        toast('<i class="ti ti-refresh"></i> A new voyage begins.');
      });
    };

    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault(); deferredPrompt = e;
      var b = $("#installBtn"); if (b) b.hidden = false;
      if (!localStorage.getItem("gl.installDismissed")) {
        setTimeout(function () {
          toastAction('<i class="ti ti-device-mobile"></i> Install Grand Line for offline access?', "Install", function () {
            if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(function () { deferredPrompt = null; installBtn.hidden = true; }); }
          });
        }, 5000);
      }
    });
    var installBtn = $("#installBtn");
    if (installBtn) installBtn.onclick = function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () { deferredPrompt = null; installBtn.hidden = true; });
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", function (e) {
        if (e.data && e.data.type === "update-available") {
          toastAction('<i class="ti ti-refresh"></i> New version available!', "Reload", function () { window.location.reload(); });
        }
      });
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }

    var remindBtn = $("#remindBtn");
    if (remindBtn) remindBtn.onclick = function () {
      if (save.player.remindersOn) {
        save.player.remindersOn = false; state.save(save); renderRemindBtn();
        toast('<i class="ti ti-bell-off"></i> Daily reminder off.');
        return;
      }
      if (!("Notification" in window)) { toast('<i class="ti ti-alert-triangle"></i> Notifications aren\'t supported here.'); return; }
      Notification.requestPermission().then(function (p) {
        if (p === "granted") {
          save.player.remindersOn = true; state.save(save); renderRemindBtn();
          try { new Notification("Grand Line", { body: "Reminder on. I'll nudge you when your streak's at risk and the app is open." }); } catch (e) {}
        } else { toast('<i class="ti ti-bell-off"></i> Notifications are blocked in your browser settings.'); }
      });
    };

    function trapFocus(e) {
      var modal = document.querySelector(".modal-backdrop:not([hidden]) .modal");
      if (!modal) return;
      var focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.key === "Tab") {
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      if (e.key === "Escape") { modal.closest(".modal-backdrop").hidden = true; if (lastFocused) lastFocused.focus(); }
    }
    document.addEventListener("keydown", function (e) {
      if (document.querySelector(".modal-backdrop:not([hidden])")) { trapFocus(e); return; }
      if (/input|textarea|select/i.test(document.activeElement.tagName)) return;
      if (e.key === "n" || e.key === "N") { show("bounties"); setTimeout(function () { $("#bountyTitle").focus(); }, 50); }
      else if (e.key === "1") show("quarters");
      else if (e.key === "2") show("bounties");
      else if (e.key === "3") show("duties");
      else if (e.key === "4") show("log");
      else if (e.key === "5") show("pose");
      else if (e.key === "6") show("hold");
      else if (e.key === "7") show("haki");
    });

    maybeNudgeBackup();
  }

  function maybeNudgeBackup() {
    try {
      if (localStorage.getItem("gl.backupNudgeDone")) return;
      if (rewards.voyageStreak(save, state.todayStr()) < 3) return;
      var today = state.todayStr();
      if (localStorage.getItem("gl.backupNudgeLastShown") === today) return;
      localStorage.setItem("gl.backupNudgeLastShown", today);
    } catch (e) { return; }
    // Delayed so backup.init()'s async IndexedDB lookup (kicked off later in
    // bootstrap) has resolved by the time isLinked() is checked here.
    setTimeout(function () {
      if (backup.isLinked()) return; // auto-backup to disk already covers this
      toastAction(
        '<i class="ti ti-shield-lock"></i> Your voyage is saved only in this browser. Back it up?',
        "Back up",
        doExportBackup
      );
    }, 1500);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function renderRemindBtn() {
    var b = $("#remindBtn"); if (!b) return;
    b.innerHTML = '<i class="ti ti-bell"></i> Daily reminder: ' + (save.player.remindersOn ? "on" : "off");
  }

  /* BOOTSTRAP */
  applyTheme();
  wire();
  renderHeader();
  renderRemindBtn();
  show("quarters");
  backup.init();
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flushSave(); });
  window.addEventListener("pagehide", flushSave);
  if (save._shieldUsed === state.todayStr()) {
    delete save._shieldUsed; state.save(save);
    setTimeout(function () { toast('<i class="ti ti-shield-half"></i> Streak Shield used — your streak survived a missed day!', true); }, 800);
  }
  if (save.player.remindersOn && "Notification" in window && Notification.permission === "granted") {
    var _td = state.todayStr();
    if (!save.logPose[_td]) {
      var _prev = rewards.voyageStreak(save, rewards.addDays(_td, -1));
      if (_prev > 0) { try { new Notification("Grand Line", { body: "🔥 Your " + _prev + "-day course breaks tonight. Log anything to keep it alive." }); } catch (e) {} }
    }
  }
  if (save.player.createdAt === state.todayStr() && !save.journal.length && save.bounties.length) {
    setTimeout(function () { toast('<i class="ti ti-skull"></i> Welcome aboard. Complete a bounty to raise your first bounty.', true); }, 600);
  }
})();
