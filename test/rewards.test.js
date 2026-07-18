"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./load-module");

const economy = loadModule("economy.js");
const state = loadModule("state.js");
const rewards = loadModule("rewards.js");

test("applyReward: first task of the day grants the one-time Set Sail berry bonus", () => {
  const save = state.freshSave();
  const today = "2026-05-01";
  const ev = rewards.applyReward(save, { berries: 10, isTask: true, today });
  assert.equal(ev.setSail, true);
  assert.equal(ev.setSailAmount, economy.BUFFS.setSail);
  assert.equal(ev.berries, 10 + economy.BUFFS.setSail);
  assert.equal(save.player.berries, 10 + economy.BUFFS.setSail);
});

test("applyReward: Set Sail bonus only fires once per day", () => {
  const save = state.freshSave();
  const today = "2026-05-01";
  rewards.applyReward(save, { berries: 10, isTask: true, today });
  const second = rewards.applyReward(save, { berries: 10, isTask: true, today });
  assert.equal(second.setSail, false);
  assert.equal(second.berries, 10);
});

test("applyReward: first task of the day grants the one-time daily bounty bonus", () => {
  const save = state.freshSave();
  const today = "2026-05-01";
  const ev = rewards.applyReward(save, { bounty: 0, isTask: true, today });
  assert.equal(ev.dailyBounty, economy.BUFFS.dailyBounty);
  assert.equal(save.player.totalBounty, economy.BUFFS.dailyBounty);
});

test("applyReward: crossing a rank threshold reports rankUp and updates rankTitle", () => {
  const save = state.freshSave();
  const today = "2026-05-01";
  const ev = rewards.applyReward(save, { bounty: 10000, isTask: true, today });
  assert.equal(save.player.totalBounty, 10000 + economy.BUFFS.dailyBounty);
  assert.ok(ev.rankUp, "expected a rankUp event when crossing the Notorious Pirate threshold");
  assert.equal(ev.rankUp.title, "Notorious Pirate");
  assert.equal(save.player.rankTitle, "Notorious Pirate");
});

test("applyReward: staying under a rank threshold reports no rankUp", () => {
  const save = state.freshSave();
  const ev = rewards.applyReward(save, { bounty: 500, isTask: true, today: "2026-05-01" });
  assert.equal(ev.rankUp, null);
  assert.equal(save.player.rankTitle, "East Blue Pirate");
});

test("applyReward: crossing a level boundary reports every level gained and grants Haki points", () => {
  const save = state.freshSave();
  const xpForLevel3 = economy.cumulativeXpForLevel(3);
  const ev = rewards.applyReward(save, {
    xp: xpForLevel3, stat: "wisdom", isTask: false, today: "2026-05-01",
  });
  assert.equal(save.stats.wisdom.level, 3);
  assert.deepEqual(ev.leveledUp, [
    { stat: "wisdom", level: 2 },
    { stat: "wisdom", level: 3 },
  ]);
  assert.equal(ev.hakiPointsGained, 2);
  assert.equal(save.player.hakiEarned, 2);
  assert.equal(save.hakiPool, 2);
});

test("applyReward: a fresh save has no streak/crew/haki bonuses, so xp/berries pass through unmultiplied", () => {
  const save = state.freshSave();
  const today = "2026-05-01";
  // Neutralize the one-time daily bonuses so this isolates the base multiplier math.
  save.player.setSailDate = today;
  save.player.bountyDayDate = today;

  const ev = rewards.applyReward(save, {
    xp: 100, stat: "strength", berries: 50, bounty: 40, isTask: true, tier: "petty", today,
  });
  assert.equal(ev.xp, 100);
  assert.equal(ev.berries, 50);
  assert.equal(ev.bountyGain, 40);
});

test("xpMultiplier: a 7-day voyage streak adds one streak-bonus tier (+5%)", () => {
  const save = state.freshSave();
  const today = "2026-05-15";
  // Populate the 6 days before "today"; applyReward marks "today" itself
  // in logPose before computing the multiplier, completing a 7-day streak.
  let cursor = today;
  for (let i = 0; i < 6; i++) {
    cursor = rewards.addDays(cursor, -1);
    save.logPose[cursor] = { tasksDone: 1, journaled: 0 };
  }

  const ev = rewards.applyReward(save, { xp: 100, stat: "strength", isTask: true, today });
  assert.equal(ev.xp, Math.round(100 * (1 + economy.BUFFS.streakPerTier)));
});

test("xpMultiplier: recruiting a crewmate with a statXp bonus boosts only their matching stat", () => {
  const save = state.freshSave();
  const swordsman = save.crew.find((c) => c.id === "swordsman");
  assert.ok(swordsman, "fixture expects a swordsman crew slot from economy.CREW");
  swordsman.recruited = true;

  const today = "2026-05-01";
  const strengthMult = rewards.xpMultiplier(save, "strength", today, {});
  const wisdomMult = rewards.xpMultiplier(save, "wisdom", today, {});
  assert.equal(strengthMult, 1.10);
  assert.equal(wisdomMult, 1);
});

test("Haki xpFloor node raises low-tier XP gains up to its floor value", () => {
  const withoutHaki = state.freshSave();
  const withHaki = state.freshSave();
  withHaki.haki["a_root"] = true; // Armament Haki root: xpFloor 15

  const today = "2026-05-01";
  const base = rewards.applyReward(withoutHaki, {
    xp: economy.TIERS.petty.xp, stat: "strength", isTask: true, tier: "petty", today,
  });
  const floored = rewards.applyReward(withHaki, {
    xp: economy.TIERS.petty.xp, stat: "strength", isTask: true, tier: "petty", today,
  });

  assert.equal(base.xp, economy.TIERS.petty.xp, "petty tier xp is below the floor, so it passes through unchanged");
  assert.equal(floored.xp, 15, "a_root's xpFloor should raise petty-tier xp up to 15");
});

test("previewReward matches applyReward's per-tier math once one-time daily bonuses are neutralized", () => {
  const save = state.freshSave();
  const today = "2026-05-01";
  save.player.setSailDate = today;
  save.player.bountyDayDate = today;

  const preview = rewards.previewReward(save, "strength", "rookie");
  const t = economy.TIERS.rookie;
  const ev = rewards.applyReward(save, {
    xp: t.xp, stat: "strength", berries: t.berries, bounty: t.bounty,
    isTask: true, tier: "rookie", today,
  });

  assert.equal(ev.xp, preview.xp);
  assert.equal(ev.berries, preview.berries);
  assert.equal(ev.bountyGain, preview.bounty);
});

test("voyageStreak: counts consecutive logged days ending today, breaks on a gap", () => {
  const save = state.freshSave();
  const today = "2026-05-15";
  save.logPose[today] = { tasksDone: 1 };
  save.logPose[rewards.addDays(today, -1)] = { tasksDone: 1 };
  save.logPose[rewards.addDays(today, -2)] = { tasksDone: 1 };
  // gap at -3
  save.logPose[rewards.addDays(today, -4)] = { tasksDone: 1 };

  assert.equal(rewards.voyageStreak(save, today), 3);
});
