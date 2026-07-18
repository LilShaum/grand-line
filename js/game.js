(function (root) {
  "use strict";
  var GL = (root.GL = root.GL || {});
  var economy = GL.economy || (typeof require !== "undefined" ? require("./economy") : null);
  var state   = GL.state   || (typeof require !== "undefined" ? require("./state") : null);
  var rewards = GL.rewards || (typeof require !== "undefined" ? require("./rewards") : null);

  function grantItem(save, key, ev) {
    if (!key) return null;
    if (!save.inventory) save.inventory = {};
    save.inventory[key] = (save.inventory[key] || 0) + 1;
    if (ev) (ev.itemsEarned = ev.itemsEarned || []).push(key);
    return key;
  }
  function checkStreakReward(save, ev) {
    var today = state.todayStr();
    var streak = rewards.voyageStreak(save, today);
    if (streak > 0 && streak % 7 === 0 && save.player.lastStreakShieldDay !== today) {
      save.player.lastStreakShieldDay = today;
      grantItem(save, "streak_shield", ev);
    }
  }
  function trackSpend(save, cost, ev) {
    var before = save.player.berriesSpent || 0;
    var after = before + cost;
    save.player.berriesSpent = after;
    var step = economy.BERRY_SPEND_MILESTONE;
    var crossed = Math.floor(after / step) - Math.floor(before / step);
    for (var i = 0; i < crossed; i++) grantItem(save, "berry_haul", ev);
  }

  function currentDispatch(save) {
    var today = state.todayStr();
    var def = economy.dispatchForDay(today);
    if (!save.dispatch || save.dispatch.date !== today || save.dispatch.id !== def.id) {
      save.dispatch = { date: today, id: def.id, progress: 0, done: false };
    }
    return { state: save.dispatch, def: def };
  }
  function dispatchMatches(def, action) {
    var m = def.match;
    if (m.kind !== action.kind) return false;
    if (m.kind === "bounty" && m.minTier) {
      return economy.TIER_KEYS.indexOf(action.tier) >= economy.TIER_KEYS.indexOf(m.minTier);
    }
    if (m.kind === "journal" && m.jtype) return action.jtype === m.jtype;
    return true;
  }
  function dispatchProgress(save, action, ev) {
    var d = currentDispatch(save);
    if (d.state.done) return;
    if (!dispatchMatches(d.def, action)) return;
    d.state.progress = (d.state.progress || 0) + 1;
    if (d.state.progress >= d.def.need) {
      d.state.done = true;
      grantItem(save, d.def.reward, ev);
      if (ev) ev.dispatchCleared = d.def;
    } else if (ev) {
      ev.dispatchProgress = { def: d.def, progress: d.state.progress };
    }
  }

  function useItem(save, key) {
    if (!save.inventory || (save.inventory[key] || 0) <= 0) return { error: "empty" };
    var def = economy.ITEMS[key];
    if (!def) return { error: "missing" };
    if (def.use === "passive") return { error: "passive" };
    if (!save.activeItems) save.activeItems = {};
    var res = { ok: true, key: key };
    if (key === "berry_haul") { save.player.berries += def.berries; res.berries = def.berries; }
    else if (key === "xp_surge") { save.activeItems.xpSurge = true; res.armed = true; }
    else if (key === "haki_focus") { save.activeItems.hakiFocus = true; res.armed = true; }
    else if (key === "log_insight") { save.activeItems.logInsight = true; res.armed = true; }
    save.inventory[key] -= 1;
    state.save(save);
    return res;
  }
  function applyStreakShield(save) {
    var today = state.todayStr();
    var yest = rewards.addDays(today, -1);
    var dayBefore = rewards.addDays(today, -2);
    var gap = !save.logPose[yest] && save.logPose[dayBefore];
    if (!gap) return;
    if (rewards.hasHaki(save, "streakInsure")) {
      var last = save.player.lastInsureDate;
      if (!last || daysBetween(last, today) >= 7) {
        save.player.lastInsureDate = today;
        save.logPose[yest] = { tasksDone: 0, journaled: 0, insured: true };
        save._insureUsed = today;
        return;
      }
    }
    if (!save.inventory || (save.inventory.streak_shield || 0) <= 0) return;
    save.inventory.streak_shield -= 1;
    save.logPose[yest] = { tasksDone: 0, journaled: 0, shielded: true };
    save._shieldUsed = today;
  }

  function addBounty(save, title, stat, tier, dueDate, recurring, health) {
    var b = state.seedBounty(title, stat, tier);
    if (dueDate) b.dueDate = dueDate;
    if (recurring) { b.recurring = recurring; b.lastCompleted = null; }
    b.health = !!health;
    save.bounties.unshift(b);
    state.save(save);
    return b;
  }

  function setFocus(save, bountyId) {
    if (!rewards.hasCrew(save, "sniper")) return { error: "locked" };
    save.focusBountyId = (save.focusBountyId === bountyId) ? null : bountyId;
    state.save(save);
    return { ok: true, focused: save.focusBountyId };
  }

  function bumpWellness(save, today) {
    if (!save.wellness) save.wellness = {};
    save.wellness[today] = (save.wellness[today] || 0) + 1;
  }
  function wellnessWeek(save) {
    var today = state.todayStr(), n = 0;
    for (var i = 0; i < 7; i++) { n += (save.wellness && save.wellness[rewards.addDays(today, -i)]) || 0; }
    return n;
  }

  function shipLog(save) {
    var today = state.todayStr(), activeDays = 0, bounties = 0, journals = 0;
    for (var i = 0; i < 7; i++) {
      var lp = save.logPose[rewards.addDays(today, -i)];
      if (lp) { activeDays++; bounties += (lp.tasksDone || 0); journals += (lp.journaled || 0); }
    }
    var days = Object.keys(save.logPose || {}).sort();
    var longest = 0, run = 0, prev = null;
    for (var j = 0; j < days.length; j++) {
      if (prev && rewards.addDays(prev, 1) === days[j]) run++; else run = 1;
      if (run > longest) longest = run;
      prev = days[j];
    }
    return { activeDays: activeDays, bounties: bounties, journals: journals, currentStreak: rewards.voyageStreak(save, today), longestStreak: longest };
  }

  function themePrice(save, baseCost) {
    if (baseCost > 0 && rewards.hasCrew(save, "shipwright")) return Math.round(baseCost * 0.9);
    return baseCost;
  }
  function nextDue(recurring, from) {
    var next = rewards.addDays(from, 1);
    if (recurring === "weekly") { next = rewards.addDays(from, 7); }
    else if (recurring === "weekdays") {
      var d = new Date(next + "T00:00:00");
      while (d.getDay() === 0 || d.getDay() === 6) { d.setDate(d.getDate() + 1); }
      next = state.todayStr(d);
    }
    return next;
  }
  function setDecree(save, bountyId) {
    if (!rewards.hasHaki(save, "decree")) return { error: "locked" };
    save.decree = { bountyId: bountyId, date: state.todayStr() };
    state.save(save);
    return { ok: true };
  }
  function weeklyCleared(save) {
    var today = state.todayStr(), n = 0;
    for (var i = 0; i < 7; i++) { var d = rewards.addDays(today, -i); if (save.logPose[d]) n += (save.logPose[d].tasksDone || 0); }
    return n;
  }
  function checkWeeklyOutput(save, ev) {
    var eff = null;
    rewards.hakiUnlocked(save).forEach(function (n) {
      if (n.effect.type === "weeklyOutput" && (!eff || n.effect.berries > eff.berries)) eff = n.effect;
    });
    if (!eff) return;
    var today = state.todayStr(), last = save.player.lastWeeklyPayout;
    if (last && daysBetween(last, today) < 7) return;
    if (weeklyCleared(save) >= eff.threshold) {
      save.player.lastWeeklyPayout = today;
      save.player.berries += eff.berries;
      var s = save.stats.ambition; if (s) { s.xp += eff.xp; s.level = economy.levelFromXp(s.xp).level; }
      if (ev) { ev.berries = (ev.berries || 0) + eff.berries; ev.weeklyOutput = eff; }
    }
  }

  function completeBounty(save, id) {
    var b = save.bounties.find(function (x) { return x.id === id; });
    if (!b) return null;
    var today = state.todayStr();
    if (b.recurring) {
      if (b.lastCompleted === today) return { already: true };
    } else if (b.status === "done") {
      return null;
    }
    var t = economy.TIERS[b.tier];
    var _ai = save.activeItems || (save.activeItems = {});
    var _surge = !!_ai.xpSurge, _focus = !!_ai.hakiFocus;
    var _mult = 1, _decreed = 0;
    if (save.decree && save.decree.bountyId === id && save.decree.date === today && rewards.hasHaki(save, "decree")) {
      _decreed = rewards.hasHaki(save, "decreeBoost") ? 3 : 2;
      _mult = _decreed;
      save.decree = null;
    }
    var _focusHit = (save.focusBountyId === id && rewards.hasCrew(save, "sniper"));
    if (_focusHit) _mult *= 1.25;
    var ev = rewards.applyReward(save, { xp: t.xp, stat: b.stat, berries: t.berries, isTask: true, tier: b.tier, bounty: t.bounty, xpSurge: _surge, hakiFocus: _focus, rewardMult: _mult });
    if (_decreed) ev.decreed = _decreed;
    if (_focusHit) { ev.focusShot = true; save.focusBountyId = null; }
    if (_surge) _ai.xpSurge = false;
    if (_focus) _ai.hakiFocus = false;
    save.player.bountiesCleared = (save.player.bountiesCleared || 0) + 1;
    var ms = economy.BOUNTY_MILESTONES.find(function (m) { return m.count === save.player.bountiesCleared; });
    if (ms) { save.player.berries += ms.bonus; ev.bountyMilestone = ms; }
    if (b.health) {
      bumpWellness(save, today);
      if (rewards.hasCrew(save, "cook")) {
        var cookBonus = Math.round(t.berries * 0.5);
        save.player.berries += cookBonus; ev.berries = (ev.berries || 0) + cookBonus; ev.cookBonus = cookBonus;
      }
      if (rewards.hasCrew(save, "doctor")) {
        var ds = save.stats.strength;
        if (ds) { ds.xp += 5; ds.level = economy.levelFromXp(ds.xp).level; ev.doctorXp = 5; ev.xp = (ev.xp || 0) + 5; }
      }
    }
    checkWeeklyOutput(save, ev);
    checkStreakReward(save, ev);
    dispatchProgress(save, { kind: "bounty", tier: b.tier }, ev);
    if (b.recurring) {
      b.lastCompleted = today;
      b.status = "open";
      b.dueDate = nextDue(b.recurring, today);
      ev.recurredTo = b.dueDate;
    } else {
      b.status = "done";
      b.completedAt = today;
    }
    state.save(save);
    return ev;
  }
  function uncompleteBounty(save, id) {
    var b = save.bounties.find(function (x) { return x.id === id; });
    if (!b || b.status !== "done") return;
    b.status = "open"; b.completedAt = null;
    state.save(save);
  }
  function deleteBounty(save, id) {
    save.bounties = save.bounties.filter(function (x) { return x.id !== id; });
    state.save(save);
  }
  function editBounty(save, id, fields) {
    var b = save.bounties.find(function (x) { return x.id === id; });
    if (!b) return null;
    if (fields.title != null) b.title = fields.title;
    if (fields.stat != null) b.stat = fields.stat;
    if (fields.tier != null) b.tier = fields.tier;
    state.save(save);
    return b;
  }
  function clearCompleted(save) {
    var n = save.bounties.filter(function (b) { return b.status === "done"; }).length;
    save.bounties = save.bounties.filter(function (b) { return b.status !== "done"; });
    state.save(save);
    return n;
  }

  function checkHabit(save, id) {
    var h = save.habits.find(function (x) { return x.id === id; });
    if (!h) return null;
    var today = state.todayStr();
    if (h.lastCheckDate === today) return { already: true };
    var yesterday = rewards.addDays(today, -1);
    h.streak = (h.lastCheckDate === yesterday) ? h.streak + 1 : 1;
    h.lastCheckDate = today;
    var t = economy.TIERS[h.tier];
    var ai = save.activeItems || (save.activeItems = {});
    var sg = !!ai.xpSurge, fc = !!ai.hakiFocus;
    var ev = rewards.applyReward(save, { xp: t.xp, stat: h.stat, berries: t.berries, isTask: true, tier: h.tier, bounty: t.bounty, xpSurge: sg, hakiFocus: fc });
    if (sg) ai.xpSurge = false;
    if (fc) ai.hakiFocus = false;
    ev.habitStreak = h.streak;
    if (h.health) bumpWellness(save, today);
    checkStreakReward(save, ev);
    dispatchProgress(save, { kind: "duty" }, ev);
    state.save(save);
    return ev;
  }
  function addHabit(save, title, stat, tier, health) {
    var h = { id: state.uid(), title: title, stat: stat, tier: tier, health: !!health, streak: 0, lastCheckDate: null };
    save.habits.push(h);
    state.save(save);
    return h;
  }
  function deleteHabit(save, id) {
    save.habits = save.habits.filter(function (x) { return x.id !== id; });
    state.save(save);
  }

  function addJournal(save, type, payload) {
    payload = payload || {};
    var today = state.todayStr();
    var def = economy.JOURNAL[type];
    if (!def) return null;
    var DAILY_SINGLE = { captains_log: 1, morning_intent: 1, evening_reflection: 1, free_write: 1 };
    if (DAILY_SINGLE[type]) {
      var existing = save.journal.find(function (e) { return e.type === type && e.date === today; });
      if (existing) {
        existing.text = payload.text || existing.text;
        state.save(save);
        return { updated: true };
      }
    }
    if (type === "recap") {
      if (!canRecap(save)) return { locked: true, daysLeft: recapDaysLeft(save) };
      save.player.lastRecapDate = today;
    }
    var entry = {
      id: state.uid(), type: type, date: today,
      text: payload.text || "", mood: payload.mood || null,
      rewardsGranted: true
    };
    save.journal.unshift(entry);
    rewards.markLogPose(save, today, "journaled");
    var ai = save.activeItems || (save.activeItems = {});
    var grantsXp = def.xp > 0 && def.stat;
    var sg = grantsXp && !!ai.xpSurge, fc = grantsXp && !!ai.hakiFocus;
    var _recapEff = (type === "recap") ? rewards.hakiEffect(save, "recapMult") : null;
    var ev = rewards.applyReward(save, { xp: def.xp, stat: def.stat, berries: def.berries, isTask: false, bounty: def.bounty, xpSurge: sg, hakiFocus: fc, rewardMult: _recapEff ? _recapEff.value : 1 });
    if (sg) ai.xpSurge = false;
    if (fc) ai.hakiFocus = false;
    if (grantsXp && ai.logInsight) { save.player.berries += 5; ev.berries = (ev.berries || 0) + 5; ev.logInsightBonus = 5; ai.logInsight = false; }
    if (def.grants) rewards.grantBuff(save, def.grants, today);
    ev.buffGranted = def.grants || null;
    checkStreakReward(save, ev);
    dispatchProgress(save, { kind: "journal", jtype: type }, ev);
    state.save(save);
    return ev;
  }
  function todaysLog(save) {
    var today = state.todayStr();
    return save.journal.find(function (e) { return e.type === "captains_log" && e.date === today; }) || null;
  }
  function daysBetween(a, b) {
    var d1 = new Date(a + "T00:00:00"), d2 = new Date(b + "T00:00:00");
    return Math.round((d2 - d1) / 86400000);
  }
  function canRecap(save) {
    var last = save.player.lastRecapDate;
    if (!last) return true;
    return daysBetween(last, state.todayStr()) >= economy.BUFFS.recapCooldownDays;
  }
  function recapDaysLeft(save) {
    if (canRecap(save)) return 0;
    return economy.BUFFS.recapCooldownDays - daysBetween(save.player.lastRecapDate, state.todayStr());
  }
  function logVictory(save, title) { return addJournal(save, "victory", { text: title }); }

  function buyReward(save, id) {
    var item = save.shop.find(function (x) { return x.id === id; });
    if (!item) return { error: "missing" };
    if (save.player.berries < item.cost) return { error: "broke", short: item.cost - save.player.berries };
    save.player.berries -= item.cost;
    if (item.type === "cosmetic") item.owned = true;
    var r = { ok: true, item: item };
    trackSpend(save, item.cost, r);
    state.save(save);
    return r;
  }
  function addShopItem(save, name, cost, type) {
    var item = { id: state.uid(), name: name, cost: Number(cost) || 0, type: type || "reward", owned: false };
    save.shop.push(item);
    state.save(save);
    return item;
  }
  function deleteShopItem(save, id) {
    save.shop = save.shop.filter(function (x) { return x.id !== id; });
    state.save(save);
  }

  function unlockHakiNode(save, nodeId) {
    var node = economy.HAKI_NODES.find(function (n) { return n.id === nodeId; });
    if (!node) return { error: "missing" };
    if (!save.haki) save.haki = {};
    if (save.haki[node.id]) return { error: "owned" };
    var missing = (node.req || []).filter(function (id) { return !save.haki[id]; });
    if (missing.length) return { error: "locked", need: missing };
    var have = save.hakiPool || 0;
    if (have < node.cost) return { error: "broke", short: node.cost - have };
    save.hakiPool = have - node.cost;
    save.haki[node.id] = true;
    var r = { ok: true, node: node };
    state.save(save);
    return r;
  }
  function hakiSpent(save, stat) {
    var spent = 0;
    (economy.HAKI_TREE[stat] || []).forEach(function (n) { if (save.haki && save.haki[n.id]) spent += n.cost; });
    return spent;
  }

  function buyTheme(save, id) {
    var t = economy.THEMES.find(function (x) { return x.id === id; });
    if (!t) return { error: "missing" };
    if (save.player.ownedThemes.indexOf(id) !== -1) return { error: "owned" };
    var cost = themePrice(save, t.cost);
    if (save.player.berries < cost) return { error: "broke", short: cost - save.player.berries };
    save.player.berries -= cost;
    save.player.ownedThemes.push(id);
    var r = { ok: true, theme: t, paid: cost };
    trackSpend(save, cost, r);
    state.save(save);
    return r;
  }
  function setActiveTheme(save, id) {
    if (save.player.ownedThemes.indexOf(id) === -1) return { error: "locked" };
    save.player.activeTheme = id;
    state.save(save);
    return { ok: true };
  }

  function recruitCrew(save, id) {
    var def = economy.CREW.find(function (d) { return d.id === id; });
    if (!def) return { error: "missing" };
    var c = save.crew.find(function (x) { return x.id === id; });
    if (c && c.recruited) return { error: "owned" };
    if (save.player.berries < def.cost) return { error: "broke", short: def.cost - save.player.berries };
    save.player.berries -= def.cost;
    if (!c) { c = { id: def.id, name: def.name, role: def.role, cost: def.cost, bonus: def.bonus, recruited: false }; save.crew.push(c); }
    c.recruited = true;
    var r = { ok: true, crew: def };
    trackSpend(save, def.cost, r);
    state.save(save);
    return r;
  }

  function onLoad(save) {
    rewards.pruneBuffs(save);
    if (!save.hakiPoints) { save.hakiPoints = {}; economy.STAT_KEYS.forEach(function (k) { save.hakiPoints[k] = 0; }); }
    if (!save.haki) save.haki = {};
    if (!save.player.ownedThemes) save.player.ownedThemes = ["grandline"];
    if (!save.player.activeTheme) save.player.activeTheme = "grandline";
    if (save.player.bountiesCleared == null) save.player.bountiesCleared = 0;
    if (save.player.berriesSpent == null) save.player.berriesSpent = 0;
    if (!save.inventory) save.inventory = { xp_surge: 0, berry_haul: 0, streak_shield: 0, haki_focus: 0, log_insight: 0 };
    if (!save.activeItems) save.activeItems = { xpSurge: false, hakiFocus: false, logInsight: false };
    if (save.player.bountyDayDate === undefined) save.player.bountyDayDate = null;
    if (save.focusBountyId === undefined) save.focusBountyId = null;
    if (!save.wellness) save.wellness = {};
    if (save.audioOn === undefined) save.audioOn = false;
    if (save.audioVolume == null) save.audioVolume = 40;
    if (save.sfxEnabled === undefined) save.sfxEnabled = true;
    (save.bounties || []).forEach(function (b) { if (b.health === undefined) b.health = false; });
    (save.habits || []).forEach(function (h) { if (h.health === undefined) h.health = false; });
    if (save.focusBountyId && !(save.bounties || []).some(function (b) { return b.id === save.focusBountyId && b.status !== "done"; })) {
      save.focusBountyId = null;
    }
    save.player.rankTitle = economy.rankForBounty(save.player.totalBounty || 0).current.title;
    if ((save.hakiVersion || 1) < 3) {
      save.haki = {};
      var earned = 0;
      economy.STAT_KEYS.forEach(function (k) {
        var lvl = save.stats[k] ? economy.levelFromXp(save.stats[k].xp).level : 1;
        earned += Math.max(0, lvl - 1);
        save.hakiPoints[k] = 0;
      });
      earned = Math.min(earned, economy.HAKI_LIFETIME_CAP);
      save.player.hakiEarned = earned;
      save.hakiPool = earned;
      save.hakiVersion = 3;
    }
    if (save.hakiPool == null) save.hakiPool = 0;
    if (save.player.hakiEarned == null) save.player.hakiEarned = 0;
    var recruitedIds = {};
    (save.crew || []).forEach(function (c) { if (c.recruited) recruitedIds[c.id] = true; });
    save.crew = economy.CREW.map(function (def) {
      return { id: def.id, name: def.name, role: def.role, cost: def.cost, bonus: def.bonus, recruited: !!recruitedIds[def.id] };
    });
    applyStreakShield(save);
    save.player.firstRun = false;
    state.save(save);
    return save;
  }

  var game = {
    addBounty: addBounty, completeBounty: completeBounty,
    uncompleteBounty: uncompleteBounty, deleteBounty: deleteBounty,
    editBounty: editBounty, clearCompleted: clearCompleted,
    checkHabit: checkHabit, addHabit: addHabit, deleteHabit: deleteHabit,
    addJournal: addJournal, todaysLog: todaysLog,
    canRecap: canRecap, recapDaysLeft: recapDaysLeft, logVictory: logVictory,
    buyReward: buyReward, addShopItem: addShopItem, deleteShopItem: deleteShopItem,
    unlockHakiNode: unlockHakiNode, hakiSpent: hakiSpent, checkWeeklyOutput: checkWeeklyOutput, nextDue: nextDue,
    buyTheme: buyTheme, setActiveTheme: setActiveTheme,
    recruitCrew: recruitCrew,
    currentDispatch: currentDispatch,
    setFocus: setFocus, wellnessWeek: wellnessWeek,
    shipLog: shipLog, themePrice: themePrice,
    setDecree: setDecree,
    useItem: useItem, grantItem: grantItem,
    onLoad: onLoad
  };
  GL.game = game;
  if (typeof module !== "undefined" && module.exports) module.exports = game;
})(typeof window !== "undefined" ? window : this);

