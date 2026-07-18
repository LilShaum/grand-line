"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./load-module");

const state = loadModule("state.js");

test("freshSave: has zeroed player stats and the three default habits", () => {
  const save = state.freshSave();
  assert.equal(save.player.berries, 0);
  assert.equal(save.player.totalBounty, 0);
  assert.equal(save.player.rankTitle, "East Blue Pirate");
  assert.equal(save.habits.length, 3);
  assert.equal(save.bounties.length, 4);
});

test("freshSave: every stat starts at level 1 with 0 xp", () => {
  const save = state.freshSave();
  Object.keys(save.stats).forEach((k) => {
    assert.equal(save.stats[k].xp, 0);
    assert.equal(save.stats[k].level, 1);
  });
});

test("freshSave: produces unique ids across bounties/habits/shop on repeated calls", () => {
  const a = state.freshSave();
  const b = state.freshSave();
  assert.notEqual(a.bounties[0].id, b.bounties[0].id);
  const allIds = [...a.bounties, ...a.habits, ...a.shop].map((x) => x.id);
  assert.equal(new Set(allIds).size, allIds.length, "ids should not collide within one save");
});

test("todayStr: formats a given date as YYYY-MM-DD with zero-padding", () => {
  const d = new Date(2026, 2, 5); // March 5 2026 (month is 0-indexed)
  assert.equal(state.todayStr(d), "2026-03-05");
});

test("load/save/reset round-trip through the in-memory store (no localStorage in Node)", () => {
  const reset1 = state.reset();
  assert.equal(reset1.player.berries, 0);

  const loaded = state.load();
  assert.equal(loaded.player.berries, 0);

  loaded.player.berries = 500;
  state.save(loaded);

  const reloaded = state.load();
  assert.equal(reloaded.player.berries, 500, "save() should persist through the fallback store, and load() should read it back");

  // reset() should wipe it back to a fresh save
  const afterReset = state.reset();
  assert.equal(afterReset.player.berries, 0);
});

test("onSave listeners fire with the saved data on every save()", () => {
  const seen = [];
  state.onSave((save, raw) => seen.push({ berries: save.player.berries, rawIsString: typeof raw === "string" }));
  const save = state.freshSave();
  save.player.berries = 42;
  state.save(save);
  const last = seen[seen.length - 1];
  assert.equal(last.berries, 42);
  assert.equal(last.rawIsString, true);
});
