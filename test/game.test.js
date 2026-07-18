"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./load-module");

const economy = loadModule("economy.js");
const state = loadModule("state.js");
const rewards = loadModule("rewards.js");
const game = loadModule("game.js");

test("addBounty: creates and prepends a new open bounty", () => {
  const save = state.freshSave();
  const before = save.bounties.length;
  const b = game.addBounty(save, "Test bounty", "wisdom", "rookie");
  assert.equal(save.bounties.length, before + 1);
  assert.equal(save.bounties[0].id, b.id, "new bounty should be prepended");
  assert.equal(b.status, "open");
  assert.equal(b.stat, "wisdom");
  assert.equal(b.tier, "rookie");
});

test("completeBounty: a non-recurring bounty is marked done, pays its tier reward, and can't be completed twice", () => {
  const save = state.freshSave();
  const b = game.addBounty(save, "Test bounty", "strength", "rookie");
  const berriesBefore = save.player.berries;
  const ev = game.completeBounty(save, b.id);
  assert.ok(ev, "expected a reward event");
  assert.equal(b.status, "done");
  assert.ok(save.player.berries > berriesBefore, "berries should increase");
  assert.equal(save.player.bountiesCleared, 1);

  const second = game.completeBounty(save, b.id);
  assert.equal(second, null, "completing an already-done non-recurring bounty should no-op");
});

test("completeBounty: clearing the 10th bounty grants the Wanted Rookie milestone bonus", () => {
  const save = state.freshSave();
  for (let i = 0; i < 9; i++) {
    const b = game.addBounty(save, "Bounty " + i, "resolve", "petty");
    game.completeBounty(save, b.id);
  }
  assert.equal(save.player.bountiesCleared, 9);
  const last = game.addBounty(save, "Bounty 10", "resolve", "petty");
  const ev = game.completeBounty(save, last.id);
  assert.equal(save.player.bountiesCleared, 10);
  assert.ok(ev.bountyMilestone, "expected a milestone event on the 10th clear");
  assert.equal(ev.bountyMilestone.title, "Wanted Rookie");
});

test("completeBounty: a recurring bounty stays open, rolls its due date forward, and allows one completion per day", () => {
  const save = state.freshSave();
  const b = game.addBounty(save, "Daily duty", "resolve", "petty", null, "daily");
  const ev = game.completeBounty(save, b.id);
  assert.ok(ev);
  assert.equal(b.status, "open", "recurring bounties stay open");
  assert.equal(b.lastCompleted, state.todayStr());
  assert.ok(b.dueDate, "recurring completion should set the next due date");

  const again = game.completeBounty(save, b.id);
  assert.deepEqual(again, { already: true });
});

test("uncompleteBounty / deleteBounty / clearCompleted", () => {
  const save = state.freshSave();
  const a = game.addBounty(save, "A", "resolve", "petty");
  const b = game.addBounty(save, "B", "resolve", "petty");

  game.completeBounty(save, a.id);
  game.uncompleteBounty(save, a.id);
  assert.equal(a.status, "open");
  assert.equal(a.completedAt, null);

  game.completeBounty(save, a.id);
  const clearedCount = game.clearCompleted(save);
  assert.equal(clearedCount, 1);
  assert.ok(!save.bounties.some((x) => x.id === a.id));
  assert.ok(save.bounties.some((x) => x.id === b.id));

  game.deleteBounty(save, b.id);
  assert.ok(!save.bounties.some((x) => x.id === b.id));
});

test("checkHabit: continues the streak when last checked yesterday", () => {
  const save = state.freshSave();
  const h = save.habits[0];
  h.lastCheckDate = rewards.addDays(state.todayStr(), -1);
  h.streak = 4;
  const ev = game.checkHabit(save, h.id);
  assert.equal(h.streak, 5);
  assert.equal(ev.habitStreak, 5);
});

test("checkHabit: resets to 1 when there was a gap since the last check-in", () => {
  const save = state.freshSave();
  const h = save.habits[0];
  h.lastCheckDate = rewards.addDays(state.todayStr(), -3);
  h.streak = 9;
  game.checkHabit(save, h.id);
  assert.equal(h.streak, 1);
});

test("checkHabit: checking in twice the same day is a no-op the second time", () => {
  const save = state.freshSave();
  const h = save.habits[0];
  game.checkHabit(save, h.id);
  const streakAfterFirst = h.streak;
  const second = game.checkHabit(save, h.id);
  assert.equal(second.already, true);
  assert.equal(h.streak, streakAfterFirst);
});

test("recruitCrew: fails with 'broke' when unaffordable, succeeds once funded, rejects double recruiting", () => {
  const save = state.freshSave();
  const cost = economy.CREW.find((c) => c.id === "swordsman").cost;

  const poor = game.recruitCrew(save, "swordsman");
  assert.equal(poor.error, "broke");
  assert.equal(save.crew.find((c) => c.id === "swordsman").recruited, false);

  save.player.berries = cost;
  const ok = game.recruitCrew(save, "swordsman");
  assert.equal(ok.ok, true);
  assert.equal(save.crew.find((c) => c.id === "swordsman").recruited, true);
  assert.equal(save.player.berries, 0);

  const again = game.recruitCrew(save, "swordsman");
  assert.equal(again.error, "owned");
});

test("unlockHakiNode: enforces prerequisites, cost, and rejects re-unlocking an owned node", () => {
  const save = state.freshSave();
  save.hakiPool = 10;

  const locked = game.unlockHakiNode(save, "o_a1"); // requires o_root first
  assert.equal(locked.error, "locked");
  assert.deepEqual(locked.need, ["o_root"]);

  const rootCost = economy.HAKI_TREE.wisdom.find((n) => n.id === "o_root").cost;
  const okRoot = game.unlockHakiNode(save, "o_root");
  assert.equal(okRoot.ok, true);
  assert.equal(save.hakiPool, 10 - rootCost);
  assert.equal(save.haki.o_root, true);

  const dup = game.unlockHakiNode(save, "o_root");
  assert.equal(dup.error, "owned");
});

test("unlockHakiNode: fails with 'broke' when the pool can't afford the node", () => {
  const save = state.freshSave();
  save.hakiPool = 0;
  const res = game.unlockHakiNode(save, "o_root");
  assert.equal(res.error, "broke");
});

test("nextDue: plain recurrence advances by one day", () => {
  assert.equal(game.nextDue(null, "2026-03-01"), "2026-03-02");
});

test("nextDue: weekly recurrence advances by seven days", () => {
  assert.equal(game.nextDue("weekly", "2026-03-01"), "2026-03-08");
});

test("nextDue: weekdays recurrence skips over the weekend", () => {
  // 2026-03-06 is a Friday; the next weekday due date should be Monday 03-09.
  assert.equal(game.nextDue("weekdays", "2026-03-06"), "2026-03-09");
});

test("onLoad: migrates a fresh save without crashing, flips firstRun off, and fills out the crew roster", () => {
  const save = state.freshSave();
  assert.equal(save.player.firstRun, true);
  const loaded = game.onLoad(save);
  assert.equal(loaded.player.firstRun, false);
  assert.equal(loaded.hakiVersion, 3);
  assert.equal(loaded.crew.length, economy.CREW.length);
});

test("buyReward: fails when unaffordable, succeeds and deducts cost once funded", () => {
  const save = state.freshSave();
  const item = save.shop[0];
  const poor = game.buyReward(save, item.id);
  assert.equal(poor.error, "broke");

  save.player.berries = item.cost;
  const ok = game.buyReward(save, item.id);
  assert.equal(ok.ok, true);
  assert.equal(save.player.berries, 0);
});

test("addJournal: memory entries only pay Berries once per day, so they can't be farmed", () => {
  const save = state.freshSave();
  save.player.setSailDate = state.todayStr(); // isTask:false anyway, but be explicit
  const memBerries = economy.JOURNAL.memory.berries;

  const first = game.addJournal(save, "memory", { text: "a" });
  assert.equal(first.berries, memBerries, "first memory of the day pays its Berries");
  const berriesAfterFirst = save.player.berries;

  for (let i = 0; i < 20; i++) game.addJournal(save, "memory", { text: "spam " + i });
  assert.equal(save.player.berries, berriesAfterFirst, "further memories the same day pay nothing");
  assert.equal(save.journal.filter((e) => e.type === "memory").length, 21, "but every entry is still saved");
});

test("addJournal: victory entries also cap their reward at once per day", () => {
  const save = state.freshSave();
  const before = save.player.berries;
  game.logVictory(save, "win one");
  const afterOne = save.player.berries;
  assert.ok(afterOne > before, "first victory pays out");
  game.logVictory(save, "win two");
  assert.equal(save.player.berries, afterOne, "second victory the same day pays nothing");
});

test("addJournal: a normal daily journal still pays in full after a capture entry", () => {
  const save = state.freshSave();
  game.addJournal(save, "memory", { text: "note" });
  const before = save.player.berries;
  const ev = game.addJournal(save, "free_write", { text: "real entry" });
  assert.ok(ev.berries > 0, "free_write is unaffected by the capture-type daily cap");
  assert.ok(save.player.berries > before);
});

test("completeBounty: decree + Focus Shot stack their reward multipliers onto XP", () => {
  const base = state.freshSave();
  const plain = game.addBounty(base, "target", "strength", "warlord");
  const plainEv = game.completeBounty(base, plain.id);

  const buffed = state.freshSave();
  buffed.haki = { c_root: true };        // Conqueror's Haki: daily decree (x2)
  buffed.crew.find((c) => c.id === "sniper").recruited = true; // Focus Shot (+25%)
  const b = game.addBounty(buffed, "target", "strength", "warlord");
  game.setDecree(buffed, b.id);
  game.setFocus(buffed, b.id);
  const ev = game.completeBounty(buffed, b.id);

  assert.equal(ev.decreed, 2, "decree reported as x2");
  assert.equal(ev.focusShot, true, "focus shot reported");
  // x2 (decree) * 1.25 (focus) = x2.5 relative to the plain clear
  assert.equal(ev.xp, Math.round(plainEv.xp * 2.5));
});
