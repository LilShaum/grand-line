(function (root) {
  "use strict";
  var GL = (root.GL = root.GL || {});
  var economy = GL.economy || (typeof require !== "undefined" ? require("./economy") : null);

  var KEY = "grandline.save.v1";

  function todayStr(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function freshSave() {
    var stats = {};
    economy.STAT_KEYS.forEach(function (k) { stats[k] = { xp: 0, level: 1 }; });
    var hakiPoints = {};
    economy.STAT_KEYS.forEach(function (k) { hakiPoints[k] = 0; });
    var habits = economy.DEFAULT_HABITS.map(function (h) {
      return { id: uid(), title: h.title, stat: h.stat, tier: h.tier, health: !!h.health, streak: 0, lastCheckDate: null };
    });
    var shop = economy.DEFAULT_SHOP.map(function (s) {
      return { id: uid(), name: s.name, cost: s.cost, type: s.type, owned: false };
    });
    var crew = economy.CREW.map(function (c) {
      return { id: c.id, name: c.name, role: c.role, cost: c.cost, bonus: c.bonus, recruited: false };
    });
    return {
      version: 1,
      rev: 0,
      player: {
        berries: 0,
        totalBounty: 0,
        rankTitle: economy.RANKS[0].title,
        activeTitle: null,
        createdAt: todayStr(),
        lastActiveDate: null,
        bountyDayDate: null,
        setSailDate: null,
        lastRecapDate: null,
        activeTheme: "grandline",
        ownedThemes: ["grandline"],
        remindersOn: false,
        bountiesCleared: 0,
        berriesSpent: 0,
        lastStreakShieldDay: null,
        comboDate: null,
        comboCount: 0,
        lastInsureDate: null,
        lastWeeklyPayout: null,
        firstRun: true
      },
      focusBountyId: null,       // Sniper: the pinned target bounty
      wellness: {},              // Doctor: "YYYY-MM-DD" -> health check-ins that day
      audioOn: false,            // Musician: ambient audio toggle
      stats: stats,
      hakiPoints: hakiPoints,
      haki: {},
      inventory: { xp_surge: 0, berry_haul: 0, streak_shield: 0, haki_focus: 0, log_insight: 0 },
      activeItems: { xpSurge: false, hakiFocus: false, logInsight: false },
      decree: null,
      bounties: [
        seedBounty("Make the bed", "resolve", "petty"),
        (function () { var b = seedBounty("30-minute workout", "strength", "rookie"); b.health = true; return b; })(),
        seedBounty("Read a chapter", "wisdom", "rookie"),
        seedBounty("Finish a work task", "ambition", "notorious")
      ],
      habits: habits,
      journal: [],
      buffs: [],
      shop: shop,
      crew: crew,
      logPose: {},
      stats_meta: { lastLevel: cloneLevels(stats) }
    };
  }

  function cloneLevels(stats) {
    var o = {};
    Object.keys(stats).forEach(function (k) { o[k] = stats[k].level; });
    return o;
  }

  function seedBounty(title, stat, tier) {
    return {
      id: uid(), title: title, stat: stat, tier: tier,
      status: "open", dueDate: null, recurring: null, health: false,
      createdAt: todayStr(), completedAt: null
    };
  }

  var memoryStore = null;
  function read() {
    try {
      var raw = (typeof localStorage !== "undefined") ? localStorage.getItem(KEY) : memoryStore;
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  var saveListeners = [];
  function onSave(fn) { if (typeof fn === "function") saveListeners.push(fn); }

  // --- multi-tab safety -------------------------------------------------
  // Every save carries a monotonic revision. A second tab holding an older
  // copy must never blind-overwrite a newer one: without this, any action in
  // a stale tab silently destroyed the other tab's progress (including
  // written journal entries).
  function storedRev() {
    try {
      var raw = (typeof localStorage !== "undefined") ? localStorage.getItem(KEY) : memoryStore;
      if (!raw) return 0;
      var data = JSON.parse(raw);
      return (data && data.rev) || 0;
    } catch (e) { return 0; }
  }
  // True when what's on disk is newer than the copy this tab is holding.
  function isStale(save) { return storedRev() > ((save && save.rev) || 0); }

  var externalListeners = [];
  function onExternalChange(fn) { if (typeof fn === "function") externalListeners.push(fn); }
  if (typeof window !== "undefined" && window.addEventListener) {
    // Fires in the OTHER tabs whenever one tab writes, so nobody stays stale.
    window.addEventListener("storage", function (e) {
      if (e.key !== KEY || !e.newValue) return;
      var data = null;
      try { data = JSON.parse(e.newValue); } catch (err) { return; }
      if (!data) return;
      for (var i = 0; i < externalListeners.length; i++) {
        try { externalListeners[i](data); } catch (err) {}
      }
    });
  }

  function write(save) {
    save.rev = ((save && save.rev) || 0) + 1;
    var raw = JSON.stringify(save);
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(KEY, raw);
      else memoryStore = raw;
    } catch (e) { memoryStore = raw; }
    for (var i = 0; i < saveListeners.length; i++) {
      try { saveListeners[i](save, raw); } catch (e) {}
    }
    return save;
  }
  function load() {
    var save = read();
    if (!save) save = write(freshSave());
    return save;
  }
  function reset() { return write(freshSave()); }

  var state = {
    KEY: KEY, uid: uid, todayStr: todayStr,
    freshSave: freshSave, seedBounty: seedBounty,
    cloneLevels: cloneLevels,
    load: load, save: write, reset: reset, onSave: onSave,
    storedRev: storedRev, isStale: isStale, onExternalChange: onExternalChange
  };

  GL.state = state;
  if (typeof module !== "undefined" && module.exports) module.exports = state;
})(typeof window !== "undefined" ? window : this);

