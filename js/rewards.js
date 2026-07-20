(function (root) {
  "use strict";
  var GL = (root.GL = root.GL || {});
  var economy = GL.economy || (typeof require !== "undefined" ? require("./economy") : null);
  var state = GL.state || (typeof require !== "undefined" ? require("./state") : null);

  function addDays(dateStr, n) {
    var d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + n);
    return state.todayStr(d);
  }
  function hakiUnlocked(save) {
    if (!save.haki) return [];
    return economy.HAKI_NODES.filter(function (n) { return save.haki[n.id]; });
  }
  function hakiEffect(save, type) {
    var nodes = hakiUnlocked(save);
    for (var i = 0; i < nodes.length; i++) { if (nodes[i].effect.type === type) return nodes[i].effect; }
    return null;
  }
  function hasHaki(save, type) { return !!hakiEffect(save, type); }
  function hakiSum(save, type) {
    var s = 0;
    hakiUnlocked(save).forEach(function (n) { if (n.effect.type === type) s += (n.effect.value || 0); });
    return s;
  }
  function hakiMax(save, type) {
    var m = 0;
    hakiUnlocked(save).forEach(function (n) { if (n.effect.type === type && (n.effect.value || 0) > m) m = n.effect.value; });
    return m;
  }
  function grantHakiPoints(save, n) {
    var cap = economy.HAKI_LIFETIME_CAP || 40;
    var earned = (save.player && save.player.hakiEarned) || 0;
    var grant = Math.max(0, Math.min(n, cap - earned));
    if (grant > 0) {
      save.player.hakiEarned = earned + grant;
      save.hakiPool = (save.hakiPool || 0) + grant;
    }
    return grant;
  }

  // --- is a specific crew member recruited? (gates crew features) ---
  function hasCrew(save, id) {
    return (save.crew || []).some(function (c) { return c.id === id && c.recruited; });
  }
  function streakCap(save) {
    var cap = economy.BUFFS.streakCap;
    (save.crew || []).forEach(function (c) {
      if (!c.recruited) return;
      var def = economy.CREW.find(function (d) { return d.id === c.id; });
      if (def && def.effect.type === "streakCap") cap += def.effect.value;
    });
    hakiUnlocked(save).forEach(function (n) { if (n.effect.type === "streakCap") cap += n.effect.value; });
    return cap;
  }
  // --- streaks with grace days ------------------------------------------
  // A missed day no longer hard-resets a streak: one miss is forgiven per
  // BUFFS.streakGraceWindowDays. Two misses inside the same window still
  // break it, so alternating on/off days can't sustain a streak forever.
  // Forgiven days keep the chain alive but don't themselves count as streak
  // days — you get credit for what you actually did.
  function streakWalk(save, today, needsTask) {
    var windowDays = economy.BUFFS.streakGraceWindowDays || 7;
    var streak = 0, cursor = today, walked = [];
    while (true) {
      var lp = save.logPose[cursor];
      var counts = !!lp && (!needsTask || (lp.tasksDone || 0) > 0);
      if (counts) {
        streak++; walked.push(false);
      } else {
        // Today being blank means the streak simply hasn't started/continued
        // yet — the day isn't over, so never spend grace on it.
        if (streak === 0) break;
        var recentMisses = 0;
        for (var i = Math.max(0, walked.length - windowDays); i < walked.length; i++) {
          if (walked[i]) recentMisses++;
        }
        if (recentMisses >= 1) break; // this window's grace is already spent
        walked.push(true);
      }
      cursor = addDays(cursor, -1);
    }
    return streak;
  }
  function voyageStreak(save, today) { return streakWalk(save, today, false); }
  function taskStreak(save, today) { return streakWalk(save, today, true); }

  // Is a free grace day available to cover a miss on dayStr? (Only when every
  // day in the preceding window was logged, i.e. no grace spent recently.)
  function graceAvailable(save, dayStr) {
    var windowDays = economy.BUFFS.streakGraceWindowDays || 7;
    for (var i = 1; i <= windowDays; i++) {
      if (!save.logPose[addDays(dayStr, -i)]) return false;
    }
    return true;
  }
  function activeBuffs(save, today) {
    return save.buffs.filter(function (b) { return b.expiresOn >= today; });
  }
  function xpMultiplier(save, stat, today, opts) {
    opts = opts || {};
    var tierDays = economy.BUFFS.streakTierDays;
    var stEff = hakiEffect(save, "streakTier");
    if (stEff && stEff.value) tierDays = stEff.value;
    var streakTiers = Math.floor(voyageStreak(save, today) / tierDays);
    var streakBonus = Math.min(streakCap(save), streakTiers * economy.BUFFS.streakPerTier);
    var tailwind = 0;
    activeBuffs(save, today).forEach(function (b) { if (b.name === "tailwind") tailwind += b.value; });
    var crewBonus = 0;
    save.crew.forEach(function (c) {
      if (!c.recruited) return;
      var def = economy.CREW.find(function (d) { return d.id === c.id; });
      if (!def) return;
      if (def.effect.type === "statXp" && def.effect.stat === stat) crewBonus += def.effect.mult;
      else if (def.effect.type === "journalXp" && opts.isJournal) crewBonus += def.effect.value;
    });
    var hakiBonus = 0;
    hakiUnlocked(save).forEach(function (n) {
      var e = n.effect;
      if (e.type === "statXp" && n.stat === stat) hakiBonus += e.value;
      else if (e.type === "tierXp" && (opts.tier === e.tier || (e.tiers && e.tiers.indexOf(opts.tier) !== -1))) hakiBonus += e.value;
      else if (e.type === "taskXp" && !opts.isJournal) hakiBonus += e.value;
      else if (e.type === "journalXp" && opts.isJournal) hakiBonus += e.value;
    });
    return 1 + streakBonus + tailwind + crewBonus + hakiBonus;
  }
  function berryMultiplier(save, today) {
    var bonus = 0;
    activeBuffs(save, today).forEach(function (b) { if (b.name === "morale") bonus += b.value; });
    (save.crew || []).forEach(function (c) {
      if (!c.recruited) return;
      var def = economy.CREW.find(function (d) { return d.id === c.id; });
      if (def && def.effect.type === "berry") bonus += def.effect.mult;
    });
    return 1 + bonus;
  }
  function markLogPose(save, today, field) {
    if (!save.logPose[today]) save.logPose[today] = { tasksDone: 0, journaled: 0 };
    if (field) save.logPose[today][field]++;
  }
  function previewReward(save, stat, tier) {
    var today = state.todayStr();
    var t = economy.TIERS[tier];
    var xp = Math.round(t.xp * xpMultiplier(save, stat, today, { tier: tier, isJournal: false }));
    var fl = hakiMax(save, "xpFloor"); if (fl) xp = Math.max(xp, fl);
    var berries = Math.round(t.berries * berryMultiplier(save, today));
    var bounty = t.bounty; var fb = hakiMax(save, "floorBounty"); if (fb) bounty = Math.max(bounty, fb);
    var bMultP = hakiSum(save, "bountyMult"); if (bMultP) bounty = Math.round(bounty * (1 + bMultP));
    return { xp: xp, berries: berries, bounty: bounty };
  }
  function applyReward(save, opts) {
    var today = opts.today || state.todayStr();
    var events = { berries: 0, xp: 0, leveledUp: [], rankUp: null, crewUnlocked: [], setSail: false };

    var rewardMult = opts.rewardMult || 1;
    var firstToday = !save.logPose[today];
    markLogPose(save, today, opts.isTask ? "tasksDone" : null);
    var combo = 1;
    if (opts.isTask) {
      if (save.player.comboDate !== today) { save.player.comboDate = today; save.player.comboCount = 1; }
      else { save.player.comboCount = (save.player.comboCount || 1) + 1; }
      combo = save.player.comboCount;
    }

    if (opts.xp && opts.stat) {
      var mult = xpMultiplier(save, opts.stat, today, { tier: opts.tier, isJournal: !opts.isTask });
      var gainedXp = Math.round(opts.xp * mult);
      if (opts.xpSurge) { gainedXp *= 2; events.xpSurged = true; }
      var cb = hakiEffect(save, "comeback");
      if (cb && firstToday && opts.isTask && !save.logPose[addDays(today, -1)]) {
        gainedXp = Math.round(gainedXp * (1 + cb.value)); events.comeback = true;
      }
      var fl = hakiMax(save, "xpFloor");
      if (fl && opts.isTask) gainedXp = Math.max(gainedXp, fl);
      if (rewardMult !== 1) gainedXp = Math.round(gainedXp * rewardMult);
      var s = save.stats[opts.stat];
      var before = economy.levelFromXp(s.xp).level;
      s.xp += gainedXp;
      var after = economy.levelFromXp(s.xp).level;
      s.level = after;
      events.xp += gainedXp;
      for (var L = before + 1; L <= after; L++) {
        events.leveledUp.push({ stat: opts.stat, level: L });
      }
      var gainedLevels = after - before;
      if (gainedLevels > 0) {
        var granted = grantHakiPoints(save, gainedLevels);
        if (granted > 0) events.hakiPointsGained = granted;
        // Once the Haki lifetime cap is reached, level-ups would otherwise
        // awaken nothing — a motivation cliff. Convert those "overflow" levels
        // into a Berry payout so leveling always rewards something.
        var overflow = gainedLevels - granted;
        if (overflow > 0) {
          var cash = overflow * (economy.BUFFS.hakiOverflowBerries || 200);
          save.player.berries += cash;
          events.berries += cash;
          events.hakiOverflowBerries = (events.hakiOverflowBerries || 0) + cash;
        }
      }
      if (opts.hakiFocus) {
        var hb = grantHakiPoints(save, Math.max(1, gainedLevels));
        if (hb > 0) {
          events.hakiPointsGained = (events.hakiPointsGained || 0) + hb;
          events.hakiFocusBonus = hb;
        }
      }
    }

    var bountyGain = opts.bounty || 0;
    if (!opts.isTask && opts.bounty) bountyGain += hakiSum(save, "journalBounty");
    if (opts.isTask && save.player.bountyDayDate !== today) {
      save.player.bountyDayDate = today;
      var dbm = hakiMax(save, "dailyBountyMult") || 1;
      bountyGain += economy.BUFFS.dailyBounty * dbm;
      events.dailyBounty = economy.BUFFS.dailyBounty * dbm;
    }
    if (bountyGain > 0) {
      var fbo = hakiMax(save, "floorBounty");
      if (fbo && opts.isTask) bountyGain = Math.max(bountyGain, fbo);
      var bMult = hakiSum(save, "bountyMult");
      if (bMult) bountyGain = Math.round(bountyGain * (1 + bMult));
      if (rewardMult !== 1) bountyGain = Math.round(bountyGain * rewardMult);
      save.player.totalBounty = (save.player.totalBounty || 0) + bountyGain;
      events.bountyGain = bountyGain;
      var rk = economy.rankForBounty(save.player.totalBounty);
      if (rk.current.title !== save.player.rankTitle) {
        save.player.rankTitle = rk.current.title;
        events.rankUp = rk.current;
      }
    }

    if (opts.berries) {
      if (opts.isTask && save.player.setSailDate !== today) {
        save.player.setSailDate = today;
        var ss = economy.BUFFS.setSail;
        hakiUnlocked(save).forEach(function (n) { if (n.effect.type === "setSailMult") ss *= n.effect.value; });
        opts.berries += ss;
        events.setSail = true;
        events.setSailAmount = ss;
      }
      var bmult = berryMultiplier(save, today);
      var gainedBerries = Math.round(opts.berries * bmult);
      if (!opts.isTask) gainedBerries += hakiSum(save, "journalBerry");
      if (rewardMult !== 1) gainedBerries = Math.round(gainedBerries * rewardMult);
      var bb = hakiEffect(save, "backToBack");
      if (bb && opts.isTask && combo >= 2) {
        var bbBonus = bb.value * Math.min(combo - 1, 6);
        gainedBerries += bbBonus; events.backToBack = bbBonus;
      }
      save.player.berries += gainedBerries;
      events.berries += gainedBerries;
    }

    save.player.lastActiveDate = today;
    return events;
  }
  
  function grantBuff(save, name, today) {
    today = today || state.todayStr();
    if (name === "morale") {
      var mb = hakiEffect(save, "moraleBoost");
      var mv = economy.BUFFS.morale + (mb ? (mb.value || 0) : 0);
      addOrRefresh(save, { name: "morale", label: "Morale (+" + Math.round(mv * 100) + "% Berries)", value: mv, expiresOn: addDays(today, 1 + (mb ? (mb.days || 0) : 0)) });
    } else if (name === "tailwind") {
      addOrRefresh(save, { name: "tailwind", label: "Tailwind (+15% XP)", value: economy.BUFFS.tailwind, expiresOn: addDays(today, economy.BUFFS.tailwindDays) });
    }
  }
  function addOrRefresh(save, buff) {
    var existing = save.buffs.find(function (b) { return b.name === buff.name; });
    if (existing) { existing.expiresOn = buff.expiresOn; existing.value = buff.value; }
    else { buff.id = state.uid(); save.buffs.push(buff); }
  }
  function pruneBuffs(save, today) {
    today = today || state.todayStr();
    save.buffs = save.buffs.filter(function (b) { return b.expiresOn >= today; });
  }

  var rewards = {
    applyReward: applyReward,
    grantBuff: grantBuff,
    pruneBuffs: pruneBuffs,
    voyageStreak: voyageStreak,
    taskStreak: taskStreak,
    xpMultiplier: xpMultiplier,
    berryMultiplier: berryMultiplier,
    activeBuffs: activeBuffs,
    streakCap: streakCap,
    hakiUnlocked: hakiUnlocked,
    graceAvailable: graceAvailable,
    hakiEffect: hakiEffect, hasHaki: hasHaki, hasCrew: hasCrew, previewReward: previewReward,
    hakiSum: hakiSum, hakiMax: hakiMax, grantHakiPoints: grantHakiPoints,
    addDays: addDays,
    markLogPose: markLogPose
  };
  GL.rewards = rewards;
  if (typeof module !== "undefined" && module.exports) module.exports = rewards;
})(typeof window !== "undefined" ? window : this);

