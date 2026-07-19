"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./load-module");

const economy = loadModule("economy.js");

test("levelFromXp: 0 xp is level 1 with 0 progress", () => {
  const r = economy.levelFromXp(0);
  assert.equal(r.level, 1);
  assert.equal(r.into, 0);
  assert.equal(r.pct, 0);
});

test("cumulativeXpForLevel / xpToNext / levelFromXp agree at exact level boundaries", () => {
  for (let level = 1; level <= 10; level++) {
    const xpAtLevelStart = economy.cumulativeXpForLevel(level);
    const r = economy.levelFromXp(xpAtLevelStart);
    assert.equal(r.level, level, `xp ${xpAtLevelStart} should land exactly on level ${level}`);
    assert.equal(r.into, 0);
  }
});

test("levelFromXp: one xp short of the next level boundary stays on the current level", () => {
  const boundary = economy.cumulativeXpForLevel(5);
  const r = economy.levelFromXp(boundary - 1);
  assert.equal(r.level, 4);
});

test("levelFromXp: pct climbs toward 100 as xp fills the level, then rolls to the next level at the boundary", () => {
  const level = 3;
  const base = economy.cumulativeXpForLevel(level);
  const need = economy.xpToNext(level);
  assert.equal(economy.levelFromXp(base).pct, 0);
  // One xp short of the next level's threshold: still level 3, pct near 100.
  const almostDone = economy.levelFromXp(base + need - 1);
  assert.equal(almostDone.level, level);
  assert.equal(almostDone.pct, 100);
  const half = economy.levelFromXp(base + Math.round(need / 2));
  assert.ok(half.pct > 0 && half.pct < 100);
  // Exactly at the threshold, it correctly rolls over to level+1 at 0%.
  const rolled = economy.levelFromXp(base + need);
  assert.equal(rolled.level, level + 1);
  assert.equal(rolled.pct, 0);
});

test("rankForBounty: 0 bounty is the starting rank with a next-rank target", () => {
  const r = economy.rankForBounty(0);
  assert.equal(r.current.title, "East Blue Pirate");
  assert.equal(r.next.title, "Notorious Pirate");
  assert.equal(r.pct, 0);
});

test("rankForBounty: exactly at a rank's minimum bounty already counts as that rank", () => {
  const r = economy.rankForBounty(10000);
  assert.equal(r.current.title, "Notorious Pirate");
});

test("rankForBounty: one below a rank's minimum is still the previous rank", () => {
  const r = economy.rankForBounty(9999);
  assert.equal(r.current.title, "East Blue Pirate");
});

test("rankForBounty: at or beyond the highest rank has no next rank and pct is 100", () => {
  const atMax = economy.rankForBounty(200000);
  assert.equal(atMax.current.title, "King of the Pirates");
  assert.equal(atMax.next, null);
  assert.equal(atMax.pct, 100);

  const beyondMax = economy.rankForBounty(999999);
  assert.equal(beyondMax.current.title, "King of the Pirates");
  assert.equal(beyondMax.next, null);
});

test("rankForBounty: pct reflects progress toward the next rank's threshold", () => {
  // East Blue Pirate (0) -> Notorious Pirate (10000); halfway is 5000
  const r = economy.rankForBounty(5000);
  assert.equal(r.current.title, "East Blue Pirate");
  assert.equal(r.pct, 50);
});

test("nextBountyMilestone: returns the first milestone not yet reached", () => {
  assert.equal(economy.nextBountyMilestone(0).count, 10);
  assert.equal(economy.nextBountyMilestone(9).count, 10);
  assert.equal(economy.nextBountyMilestone(10).count, 25);
});

test("nextBountyMilestone: returns null once every milestone is cleared", () => {
  const last = economy.BOUNTY_MILESTONES[economy.BOUNTY_MILESTONES.length - 1];
  assert.equal(economy.nextBountyMilestone(last.count), null);
});

test("TIERS: every tier has consistent positive xp/berries/bounty", () => {
  economy.TIER_KEYS.forEach((key) => {
    const t = economy.TIERS[key];
    assert.ok(t.xp > 0, `${key} xp should be positive`);
    assert.ok(t.berries > 0, `${key} berries should be positive`);
    assert.ok(t.bounty > 0, `${key} bounty should be positive`);
  });
});

test("TIERS: higher tiers strictly pay more than lower tiers", () => {
  for (let i = 1; i < economy.TIER_KEYS.length; i++) {
    const prev = economy.TIERS[economy.TIER_KEYS[i - 1]];
    const cur = economy.TIERS[economy.TIER_KEYS[i]];
    assert.ok(cur.xp > prev.xp, `${economy.TIER_KEYS[i]} xp should exceed ${economy.TIER_KEYS[i - 1]}`);
    assert.ok(cur.berries > prev.berries);
    assert.ok(cur.bounty > prev.bounty);
  }
});

test("HAKI_TREE: every non-root node's prerequisites exist in the same tree", () => {
  economy.STAT_KEYS.forEach((stat) => {
    const nodes = economy.HAKI_TREE[stat];
    const ids = new Set(nodes.map((n) => n.id));
    nodes.forEach((n) => {
      n.req.forEach((reqId) => {
        assert.ok(ids.has(reqId), `${stat} node ${n.id} requires missing node ${reqId}`);
      });
    });
  });
});

test("HAKI_TREE: the All-Seeing Eye capstone must actually improve on the base streak tiering", () => {
  // Guards against a no-op node: if BUFFS.streakTierDays is ever lowered to
  // match this node's value, the 6-point capstone silently does nothing.
  const capstone = economy.HAKI_TREE.wisdom.find((n) => n.id === "o_cap");
  assert.equal(capstone.effect.type, "streakTier");
  assert.ok(
    capstone.effect.value < economy.BUFFS.streakTierDays,
    `All-Seeing Eye tiers every ${capstone.effect.value}d but the base is already ${economy.BUFFS.streakTierDays}d — the node would be worthless`
  );
});

test("HAKI_TREE: every tree has exactly one root (no prerequisites)", () => {
  economy.STAT_KEYS.forEach((stat) => {
    const roots = economy.HAKI_TREE[stat].filter((n) => n.req.length === 0);
    assert.equal(roots.length, 1, `${stat} tree should have exactly one root node`);
  });
});

test("promptForDay / loreForDay / morningPrompt / eveningPrompt are deterministic for a given date", () => {
  const date = "2026-03-15";
  assert.equal(economy.promptForDay(date), economy.promptForDay(date));
  assert.equal(economy.loreForDay(date), economy.loreForDay(date));
  assert.equal(economy.morningPrompt(date), economy.morningPrompt(date));
  assert.equal(economy.eveningPrompt(date), economy.eveningPrompt(date));
});
